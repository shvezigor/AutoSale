import { randomUUID } from 'node:crypto';

import { replyDraftJobSchema, type ReplyDraftSource } from '@autosale/contracts/reply-drafts';
import {
  assertTenantAcceptingMutations, Prisma, TenantLifecycleFrozenError,
  type PrismaClient, withTenantTransaction,
} from '@autosale/database';

import { asksForConfirmedAvailability, selectCatalogueCandidates, selectRequestedModelSources } from './catalogue-candidates.js';
import { CatalogueRetrievalError, retrieveCatalogueCandidates } from './catalogue-retrieval.js';
import { validateReplyDraft, type GeneratedReply } from './claim-validator.js';
import { buildSafeReplyInput } from './input-sanitizer.js';
import {
  REPLY_DRAFT_PROMPT_VERSION, REPLY_DRAFT_SCHEMA_VERSION,
  ReplyModelInvalidResponseError, type ReplyGeneratorInput,
} from './openai-reply-draft-generator.js';

interface DraftGenerator {
  generate(input: ReplyGeneratorInput): Promise<{
    reply: unknown;
    metadata: { model: string; latencyMs: number; inputTokens: number; outputTokens: number };
  }>;
}

export class ReplyDraftProcessor {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly generator: DraftGenerator,
    private readonly now: () => Date = () => new Date(),
    private readonly retrieveCandidates: typeof retrieveCatalogueCandidates = retrieveCatalogueCandidates,
  ) {}

  async process(rawJob: unknown): Promise<'READY' | 'BLOCKED' | 'STALE' | 'FAILED' | 'SKIPPED' | 'DEFERRED'> {
    const { tenantId, draftId } = replyDraftJobSchema.parse(rawJob);
    const leaseId = randomUUID();
    let context;
    try {
      context = await withTenantTransaction(this.prisma, tenantId, async (tx) => {
        await assertTenantAcceptingMutations(tx, tenantId, 'CONVERSATION_REPLY');
        const draft = await tx.aiReplyDraft.findFirst({ where: { id: draftId, tenantId } });
        if (!draft || !['QUEUED', 'PROCESSING'].includes(draft.status) || draft.attempts >= 3) return null;
        const now = this.now();
        if (draft.status === 'QUEUED' && draft.availableAt > now) {
          return { outcome: 'DEFERRED' as const };
        }
        if (draft.status === 'PROCESSING' && (draft.modelRequestStartedAt || !draft.leaseExpiresAt || draft.leaseExpiresAt > now)) return null;
        const claimed = await tx.aiReplyDraft.updateMany({
          where: {
            id: draftId, tenantId, status: draft.status,
            ...(draft.status === 'PROCESSING' ? { leaseId: draft.leaseId, modelRequestStartedAt: null, leaseExpiresAt: { lte: now } } : {}),
          },
          data: { status: 'PROCESSING', leaseId, leaseExpiresAt: new Date(now.getTime() + 5 * 60_000), attempts: { increment: 1 } },
        });
        if (claimed.count !== 1) return null;
        const style = await tx.tenantReplyStyle.findUnique({ where: { tenantId } });
        if (!style?.enabled) {
          await tx.aiReplyDraft.updateMany({
            where: { id: draftId, tenantId, leaseId, status: 'PROCESSING' },
            data: { status: 'BLOCKED', errorCode: 'FEATURE_DISABLED', leaseId: null, leaseExpiresAt: null },
          });
          return null;
        }
        const anchor = await tx.message.findFirst({
          where: {
            tenantId,
            conversationId: draft.conversationId,
            direction: 'INBOUND',
            text: { not: null },
          },
          orderBy: [{ sourceTimestamp: 'desc' }, { id: 'desc' }],
          select: { id: true, text: true },
        });
        if (!anchor || anchor.id !== draft.anchorMessageId) {
          await tx.aiReplyDraft.updateMany({
            where: { id: draftId, tenantId, leaseId, status: 'PROCESSING' },
            data: { status: 'STALE', errorCode: 'NEW_MESSAGE', leaseId: null, leaseExpiresAt: null },
          });
          return null;
        }
        const recent = await tx.message.findMany({
          where: { tenantId, conversationId: draft.conversationId, id: { not: anchor.id }, text: { not: null } },
          orderBy: [{ sourceTimestamp: 'desc' }, { id: 'desc' }], take: 3,
          select: { text: true },
        });
        const safe = buildSafeReplyInput(anchor.text ?? '', recent.reverse().map((message) => message.text ?? ''));
        return {
          outcome: 'PROCESS' as const,
          conversationId: draft.conversationId, anchorMessageId: draft.anchorMessageId,
          triggerSource: draft.triggerSource,
          style: { companyName: style.companyName, tone: style.tone as ReplyGeneratorInput['style']['tone'],
            addressForm: style.addressForm as ReplyGeneratorInput['style']['addressForm'],
            guidance: buildSafeReplyInput(style.guidance, []).latestInbound },
          safe,
        };
      });
    } catch (error) {
      if (error instanceof TenantLifecycleFrozenError) return 'SKIPPED';
      throw error;
    }
    if (!context) return 'SKIPPED';
    if (context.outcome === 'DEFERRED') return 'DEFERRED';

    let recalled;
    try {
      recalled = await withTenantTransaction(this.prisma, tenantId, async (tx) => {
        await assertTenantAcceptingMutations(tx, tenantId, 'CONVERSATION_REPLY');
        const current = await tx.aiReplyDraft.findFirst({
          where: { id: draftId, tenantId, leaseId, status: 'PROCESSING' },
          select: { id: true },
        });
        if (!current) return { outcome: 'SKIPPED' as const };
        const latest = await tx.message.findFirst({
          where: { tenantId, conversationId: context.conversationId, direction: 'INBOUND', text: { not: null } },
          orderBy: [{ sourceTimestamp: 'desc' }, { id: 'desc' }], select: { id: true },
        });
        if (latest?.id !== context.anchorMessageId) {
          await tx.aiReplyDraft.updateMany({ where: { id: draftId, tenantId, leaseId, status: 'PROCESSING' },
            data: { status: 'STALE', errorCode: 'NEW_MESSAGE', leaseId: null, leaseExpiresAt: null } });
          return { outcome: 'STALE' as const };
        }
        const enabled = await tx.tenantReplyStyle.findUnique({ where: { tenantId }, select: { enabled: true } });
        if (!enabled?.enabled) {
          await tx.aiReplyDraft.updateMany({ where: { id: draftId, tenantId, leaseId, status: 'PROCESSING' },
            data: { status: 'BLOCKED', errorCode: 'FEATURE_DISABLED', leaseId: null, leaseExpiresAt: null } });
          return { outcome: 'BLOCKED' as const };
        }
        const candidateResult = await this.retrieveCandidates(
          tx, tenantId, context.safe.latestInbound, context.safe.recentContext,
        );
        if (candidateResult.modelOverflow) {
          const automatic = context.triggerSource === 'AUTOMATIC';
          const clarification = safeAutomaticClarification(context.safe.latestInbound);
          await tx.aiReplyDraft.updateMany({
            where: { id: draftId, tenantId, leaseId, status: 'PROCESSING' },
            data: {
              status: automatic ? 'READY' : 'BLOCKED', outcome: automatic ? 'CLARIFY' : null,
              generatedText: automatic ? clarification.text : null,
              sourceSnapshot: [], errorCode: automatic ? null : 'CATALOGUE_MODEL_OVERFLOW',
              promptVersion: automatic ? REPLY_DRAFT_PROMPT_VERSION : null,
              schemaVersion: automatic ? REPLY_DRAFT_SCHEMA_VERSION : null,
              modelVersion: automatic ? 'safe-fallback' : null,
              providerLatencyMs: automatic ? 0 : null,
              inputTokens: automatic ? 0 : null, outputTokens: automatic ? 0 : null,
              leaseId: null, leaseExpiresAt: null,
            },
          });
          return { outcome: automatic ? 'READY' as const : 'BLOCKED' as const };
        }
        const sources = selectCatalogueCandidates(candidateResult.products, tenantId,
          context.safe.latestInbound, context.safe.recentContext);
        await tx.aiReplyDraft.updateMany({
          where: { id: draftId, tenantId, leaseId, status: 'PROCESSING' },
          data: { sourceSnapshot: sources as unknown as Prisma.InputJsonValue },
        });
        return { outcome: 'PROCESS' as const, sources };
      });
    } catch (error) {
      if (error instanceof CatalogueRetrievalError) {
        await this.finish(tenantId, draftId, leaseId, { status: 'FAILED', errorCode: 'CATALOGUE_RETRIEVAL_FAILED' });
        return 'FAILED';
      }
      if (error instanceof TenantLifecycleFrozenError) {
        await withTenantTransaction(this.prisma, tenantId, (tx) => tx.aiReplyDraft.updateMany({
          where: { id: draftId, tenantId, leaseId, status: 'PROCESSING' },
          data: { status: 'BLOCKED', errorCode: 'TENANT_FROZEN', leaseId: null, leaseExpiresAt: null },
        }));
        return 'BLOCKED';
      }
      throw error;
    }
    if (recalled.outcome !== 'PROCESS') return recalled.outcome;
    const sources = recalled.sources;

    const started = await withTenantTransaction(this.prisma, tenantId, (tx) => tx.aiReplyDraft.updateMany({
      where: { id: draftId, tenantId, leaseId, status: 'PROCESSING', modelRequestStartedAt: null },
      data: { modelRequestStartedAt: new Date() },
    }));
    if (started.count !== 1) return 'SKIPPED';

    let generated;
    try {
      generated = await this.generator.generate({
        latestInbound: context.safe.latestInbound,
        recentContext: context.safe.recentContext,
        style: context.style,
        sources,
      });
    } catch (error) {
      if (error instanceof ReplyModelInvalidResponseError && context.triggerSource === 'AUTOMATIC') {
        generated = {
          reply: safeAutomaticResponse(context.safe.latestInbound, context.safe.recentContext, sources),
          metadata: { model: 'safe-fallback', latencyMs: 0, inputTokens: 0, outputTokens: 0 },
        };
      } else {
        await this.finish(tenantId, draftId, leaseId, {
          status: 'FAILED', errorCode: error instanceof ReplyModelInvalidResponseError ? 'INVALID_RESPONSE' : 'PROVIDER_UNAVAILABLE',
        });
        return 'FAILED';
      }
    }

    const result = await withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const current = await tx.aiReplyDraft.findFirst({ where: { id: draftId, tenantId, leaseId, status: 'PROCESSING' } });
      if (!current) return 'SKIPPED' as const;
      try {
        await assertTenantAcceptingMutations(tx, tenantId, 'CONVERSATION_REPLY');
      } catch (error) {
        if (!(error instanceof TenantLifecycleFrozenError)) throw error;
        await tx.aiReplyDraft.updateMany({ where: { id: draftId, tenantId, leaseId, status: 'PROCESSING' },
          data: { status: 'BLOCKED', errorCode: 'TENANT_FROZEN', leaseId: null, leaseExpiresAt: null } });
        return 'BLOCKED' as const;
      }
      const style = await tx.tenantReplyStyle.findUnique({ where: { tenantId }, select: { enabled: true } });
      if (!style?.enabled) {
        await tx.aiReplyDraft.updateMany({ where: { id: draftId, tenantId, leaseId, status: 'PROCESSING' },
          data: { status: 'BLOCKED', errorCode: 'FEATURE_DISABLED', leaseId: null, leaseExpiresAt: null } });
        return 'BLOCKED' as const;
      }
      const latest = await tx.message.findFirst({
        where: {
          tenantId,
          conversationId: context.conversationId,
          direction: 'INBOUND',
          text: { not: null },
        },
        orderBy: [{ sourceTimestamp: 'desc' }, { id: 'desc' }], select: { id: true },
      });
      const currentProducts = await tx.product.findMany({
        where: { tenantId, id: { in: sources.map((source) => source.productId) } },
        select: { id: true, updatedAt: true, active: true },
      });
      if (latest?.id !== context.anchorMessageId || !sourcesCurrent(sources, currentProducts)) {
        await tx.aiReplyDraft.updateMany({ where: { id: draftId, tenantId, leaseId, status: 'PROCESSING' },
          data: { status: 'STALE', errorCode: latest?.id !== context.anchorMessageId ? 'NEW_MESSAGE' : 'SOURCE_CHANGED',
            leaseId: null, leaseExpiresAt: null } });
        return 'STALE' as const;
      }
      const checked = validateReplyDraft(generated.reply, sources);
      const asksAboutStock = asksForConfirmedAvailability(context.safe.latestInbound, context.safe.recentContext);
      const catalogueOptions = current.triggerSource === 'AUTOMATIC'
        ? safeAutomaticCatalogueOptions(context.safe.latestInbound, context.safe.recentContext, sources)
        : null;
      const safeFallback = catalogueOptions ?? (asksAboutStock
        ? safeAutomaticStockClarification(context.safe.latestInbound)
        : safeAutomaticClarification(context.safe.latestInbound));
      const modelOffersUnconfirmedStock = asksAboutStock && checked.ok && checked.reply.outcome === 'ANSWER'
        && (checked.reply.productIds.length === 0 || checked.reply.productIds.some((id) =>
          !sources.some((source) => source.productId === id && source.stockQuantity !== null && source.stockQuantity > 0)));
      const needsStockSafeFallback = asksAboutStock && checked.ok
        && (checked.reply.outcome !== 'ANSWER' || modelOffersUnconfirmedStock);
      const validated = checked.ok
        ? modelOffersUnconfirmedStock && current.triggerSource !== 'AUTOMATIC'
          ? { ok: false as const, code: 'UNGROUNDED_CLAIM' as const }
          : current.triggerSource === 'AUTOMATIC' && (needsStockSafeFallback
            || (catalogueOptions && checked.reply.outcome === 'CLARIFY' && checked.reply.productIds.length === 0))
          ? { ok: true as const, reply: safeFallback }
          : checked
        : current.triggerSource === 'AUTOMATIC'
          ? { ok: true as const, reply: safeFallback }
          : checked;
      await tx.aiReplyDraft.updateMany({
        where: { id: draftId, tenantId, leaseId, status: 'PROCESSING' },
        data: {
          status: validated.ok ? 'READY' : 'BLOCKED',
          outcome: validated.ok ? validated.reply.outcome : null,
          generatedText: validated.ok ? validated.reply.text : null,
          errorCode: validated.ok ? null : validated.code,
          promptVersion: REPLY_DRAFT_PROMPT_VERSION, schemaVersion: REPLY_DRAFT_SCHEMA_VERSION,
          modelVersion: generated.metadata.model, providerLatencyMs: generated.metadata.latencyMs,
          inputTokens: generated.metadata.inputTokens, outputTokens: generated.metadata.outputTokens,
          leaseId: null, leaseExpiresAt: null,
        },
      });
      return validated.ok ? 'READY' as const : 'BLOCKED' as const;
    });
    return result;
  }

  private async finish(tenantId: string, draftId: string, leaseId: string,
    data: { status: 'FAILED'; errorCode: 'INVALID_RESPONSE' | 'PROVIDER_UNAVAILABLE' | 'CATALOGUE_RETRIEVAL_FAILED' }): Promise<void> {
    await withTenantTransaction(this.prisma, tenantId, (tx) => tx.aiReplyDraft.updateMany({
      where: { id: draftId, tenantId, leaseId, status: 'PROCESSING' },
      data: { ...data, leaseId: null, leaseExpiresAt: null },
    }));
  }
}

function safeAutomaticClarification(latestInbound: string) {
  const ukrainian = /[\u0400-\u04FF]/u.test(latestInbound);
  return {
    outcome: 'CLARIFY' as const,
    text: ukrainian
      ? 'Уточніть, будь ласка, який саме товар або модель вас цікавить.'
      : 'Please clarify which product or model you are interested in.',
    productIds: [],
    claims: [],
  };
}

function safeAutomaticStockClarification(latestInbound: string) {
  const ukrainian = /[\u0400-\u04FF]/u.test(latestInbound);
  return {
    outcome: 'CLARIFY' as const,
    text: ukrainian
      ? 'Поки що не можу підтвердити наявність: потрібно додатково перевірити залишок.'
      : 'I cannot confirm availability yet; the current stock needs to be checked.',
    productIds: [],
    claims: [],
  };
}

function safeAutomaticResponse(
  latestInbound: string,
  recentContext: readonly string[],
  sources: readonly ReplyDraftSource[],
): GeneratedReply {
  return safeAutomaticCatalogueOptions(latestInbound, recentContext, sources)
    ?? (asksForConfirmedAvailability(latestInbound, recentContext)
      ? safeAutomaticStockClarification(latestInbound)
      : safeAutomaticClarification(latestInbound));
}

function safeAutomaticCatalogueOptions(
  latestInbound: string,
  recentContext: readonly string[],
  sources: readonly ReplyDraftSource[],
): GeneratedReply | null {
  const asksAboutStock = asksForConfirmedAvailability(latestInbound, recentContext);
  const eligibleSources = asksAboutStock
    ? sources.filter((source) => source.stockQuantity !== null && source.stockQuantity > 0)
    : sources;
  const options = selectRequestedModelSources(eligibleSources, latestInbound, recentContext);
  if (options.length === 0) return null;
  const ukrainian = /[\u0400-\u04FF]/u.test(latestInbound);
  let text = ukrainian
    ? options.length === 1 ? 'Знайшов у каталозі такий варіант:\n' : 'Можу запропонувати такі варіанти:\n'
    : options.length === 1 ? 'I found this catalogue option:\n' : 'I can offer these options:\n';
  const claims: GeneratedReply['claims'] = [];
  for (const source of options) {
    text += '• ';
    const start = text.length;
    text += source.name;
    claims.push({
      start, end: text.length, text: source.name, type: 'NAME', field: 'name', productId: source.productId,
    });
    if (asksAboutStock) {
      text += ' — ';
      const availability = ukrainian ? 'в наявності' : 'in stock';
      const availabilityStart = text.length;
      text += availability;
      claims.push({
        start: availabilityStart, end: text.length, text: availability,
        type: 'AVAILABILITY', field: 'stockQuantity', productId: source.productId,
      });
    }
    text += '\n';
  }
  text += ukrainian
    ? options.length === 1 ? 'Цей варіант вам підходить?' : 'Який варіант вам підходить?'
    : options.length === 1 ? 'Does this option work for you?' : 'Which option works for you?';
  const reply: GeneratedReply = {
    outcome: 'ANSWER', text, productIds: options.map((source) => source.productId), claims,
  };
  return validateReplyDraft(reply, sources).ok ? reply : null;
}

function sourcesCurrent(sources: readonly ReplyDraftSource[], products: readonly { id: string; active: boolean; updatedAt: Date }[]): boolean {
  const byId = new Map(products.map((product) => [product.id, product]));
  return sources.every((source) => {
    const product = byId.get(source.productId);
    return product?.active === true && product.updatedAt.toISOString() === source.updatedAt;
  });
}
