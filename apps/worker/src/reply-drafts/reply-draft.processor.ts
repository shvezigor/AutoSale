import { randomUUID } from 'node:crypto';

import { replyDraftJobSchema, type ReplyDraftSource } from '@autosale/contracts/reply-drafts';
import {
  assertTenantAcceptingMutations, Prisma, TenantLifecycleFrozenError,
  type PrismaClient, withTenantTransaction,
} from '@autosale/database';

import { selectCatalogueCandidates } from './catalogue-candidates.js';
import { validateReplyDraft } from './claim-validator.js';
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
          where: { tenantId, conversationId: draft.conversationId, direction: 'INBOUND' },
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
        const products = await tx.product.findMany({
          where: { tenantId, active: true }, orderBy: [{ sku: 'asc' }, { id: 'asc' }], take: 2_000,
          select: {
            id: true, tenantId: true, sku: true, name: true, aliases: true,
            brand: true, category: true, color: true, size: true, attributes: true,
            price: true, currency: true, stockQuantity: true, active: true, updatedAt: true,
          },
        });
        const sources = selectCatalogueCandidates(products, tenantId, safe.latestInbound, safe.recentContext);
        await tx.aiReplyDraft.updateMany({
          where: { id: draftId, tenantId, leaseId, status: 'PROCESSING' },
          data: { sourceSnapshot: sources as unknown as Prisma.InputJsonValue },
        });
        return {
          outcome: 'PROCESS' as const,
          conversationId: draft.conversationId, anchorMessageId: draft.anchorMessageId,
          triggerSource: draft.triggerSource,
          style: { companyName: style.companyName, tone: style.tone as ReplyGeneratorInput['style']['tone'],
            addressForm: style.addressForm as ReplyGeneratorInput['style']['addressForm'],
            guidance: buildSafeReplyInput(style.guidance, []).latestInbound },
          sources, safe,
        };
      });
    } catch (error) {
      if (error instanceof TenantLifecycleFrozenError) return 'SKIPPED';
      throw error;
    }
    if (!context) return 'SKIPPED';
    if (context.outcome === 'DEFERRED') return 'DEFERRED';

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
        sources: context.sources,
      });
    } catch (error) {
      if (error instanceof ReplyModelInvalidResponseError && context.triggerSource === 'AUTOMATIC') {
        generated = {
          reply: safeAutomaticClarification(context.safe.latestInbound),
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
        where: { tenantId, conversationId: context.conversationId, direction: 'INBOUND' },
        orderBy: [{ sourceTimestamp: 'desc' }, { id: 'desc' }], select: { id: true },
      });
      const currentProducts = await tx.product.findMany({
        where: { tenantId, id: { in: context.sources.map((source) => source.productId) } },
        select: { id: true, updatedAt: true, active: true },
      });
      if (latest?.id !== context.anchorMessageId || !sourcesCurrent(context.sources, currentProducts)) {
        await tx.aiReplyDraft.updateMany({ where: { id: draftId, tenantId, leaseId, status: 'PROCESSING' },
          data: { status: 'STALE', errorCode: latest?.id !== context.anchorMessageId ? 'NEW_MESSAGE' : 'SOURCE_CHANGED',
            leaseId: null, leaseExpiresAt: null } });
        return 'STALE' as const;
      }
      const checked = validateReplyDraft(generated.reply, context.sources);
      const validated = checked.ok
        ? checked
        : current.triggerSource === 'AUTOMATIC'
          ? { ok: true as const, reply: safeAutomaticClarification(context.safe.latestInbound) }
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
    data: { status: 'FAILED'; errorCode: 'INVALID_RESPONSE' | 'PROVIDER_UNAVAILABLE' }): Promise<void> {
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

function sourcesCurrent(sources: readonly ReplyDraftSource[], products: readonly { id: string; active: boolean; updatedAt: Date }[]): boolean {
  const byId = new Map(products.map((product) => [product.id, product]));
  return sources.every((source) => {
    const product = byId.get(source.productId);
    return product?.active === true && product.updatedAt.toISOString() === source.updatedAt;
  });
}
