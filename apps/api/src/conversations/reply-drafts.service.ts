import { randomUUID } from 'node:crypto';

import { replyDraftSummarySchema, type ReplyDraftSummary } from '@autosale/contracts/reply-drafts';
import { assertTenantAcceptingMutations, Prisma, type PrismaClient, withTenantTransaction } from '@autosale/database';
import { ConflictException, HttpException, HttpStatus, Logger, NotFoundException } from '@nestjs/common';

export interface ReplyDraftQueue {
  add(
    name: 'ai-replies.generate',
    data: { tenantId: string; draftId: string },
    options: { jobId: string; delay: number; attempts: 1; removeOnComplete: true; removeOnFail: true },
  ): Promise<unknown>;
}

export class ReplyDraftsService {
  private readonly logger = new Logger(ReplyDraftsService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly queue: ReplyDraftQueue,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(tenantId: string, actorUserId: string, conversationId: string, idempotencyKey: string): Promise<ReplyDraftSummary> {
    let draft;
    try {
      draft = await withTenantTransaction(this.prisma, tenantId, async (tx) => {
      await assertTenantAcceptingMutations(tx, tenantId, 'CONVERSATION_REPLY');
      const conversation = await tx.conversation.findFirst({ where: { id: conversationId, tenantId }, select: { id: true } });
      if (!conversation) throw new NotFoundException('Conversation not found');
      const style = await tx.tenantReplyStyle.findUnique({ where: { tenantId }, select: { enabled: true } });
      if (!style?.enabled) throw new ConflictException('AI drafts are disabled');
      const anchor = await tx.message.findFirst({
        where: { tenantId, conversationId, direction: 'INBOUND' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      });
      if (!anchor) throw new ConflictException('Conversation has no inbound message');

      await tx.aiReplyDraft.updateMany({
        where: { tenantId, conversationId, status: { in: ['QUEUED', 'PROCESSING', 'READY'] }, anchorMessageId: { not: anchor.id } },
        data: { status: 'STALE', errorCode: 'NEW_MESSAGE', leaseId: null, leaseExpiresAt: null },
      });

      const replay = await tx.aiReplyDraft.findFirst({ where: { tenantId, conversationId, anchorMessageId: anchor.id, idempotencyKey } });
      if (replay) return replay;
      const active = await tx.aiReplyDraft.findFirst({
        where: { tenantId, conversationId, anchorMessageId: anchor.id, status: { in: ['QUEUED', 'PROCESSING'] } },
      });
      if (active) return active;

      const now = this.now();
      const since = new Date(now.getTime() - 60_000);
      const [actorCount, tenantCount, activeTenantCount] = await Promise.all([
        tx.aiReplyDraft.count({ where: { tenantId, createdByUserId: actorUserId, createdAt: { gte: since } } }),
        tx.aiReplyDraft.count({ where: { tenantId, createdAt: { gte: since } } }),
        tx.aiReplyDraft.count({ where: { tenantId, status: { in: ['QUEUED', 'PROCESSING'] } } }),
      ]);
      if (actorCount >= 5 || tenantCount >= 30 || activeTenantCount >= 3) {
        throw new HttpException('AI draft rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
      }

      return tx.aiReplyDraft.create({
        data: {
          id: randomUUID(), tenantId, conversationId, anchorMessageId: anchor.id,
          createdByUserId: actorUserId, idempotencyKey, triggerSource: 'MANUAL', availableAt: now,
        },
      });
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      draft = await withTenantTransaction(this.prisma, tenantId, async (tx) => {
        const anchor = await tx.message.findFirst({
          where: { tenantId, conversationId, direction: 'INBOUND' },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true },
        });
        if (!anchor) return null;
        return tx.aiReplyDraft.findFirst({
          where: {
            tenantId, conversationId, anchorMessageId: anchor.id,
            OR: [{ idempotencyKey }, { status: { in: ['QUEUED', 'PROCESSING'] } }],
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
      });
      if (!draft) throw error;
    }

    if (draft.status === 'QUEUED') {
      try {
        await this.queue.add('ai-replies.generate', { tenantId, draftId: draft.id }, {
          jobId: `ai-reply-${draft.id}`,
          delay: Math.max(0, draft.availableAt.getTime() - this.now().getTime()),
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: true,
        });
      } catch {
        this.logger.warn(`AI reply queue wake-up failed for draft ${draft.id}`);
      }
    }
    return toReplyDraftSummary(draft);
  }

  async list(tenantId: string, conversationId: string): Promise<ReplyDraftSummary[]> {
    const rows = await withTenantTransaction(this.prisma, tenantId, (tx) => tx.aiReplyDraft.findMany({
      where: { tenantId, conversationId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 5,
    }));
    return rows.map(toReplyDraftSummary);
  }
}

export function toReplyDraftSummary(row: {
  id: string; conversationId: string; anchorMessageId: string;
  triggerSource: string; availableAt: Date;
  status: string; outcome: string | null; generatedText: string | null; finalText: string | null;
  sourceSnapshot: unknown; errorCode: string | null; createdAt: Date; updatedAt: Date;
}): ReplyDraftSummary {
  const safeError = [
    'NO_SAFE_CANDIDATES', 'UNGROUNDED_CLAIM', 'SOURCE_CHANGED', 'NEW_MESSAGE',
    'PROVIDER_UNAVAILABLE', 'INVALID_RESPONSE', 'FEATURE_DISABLED', 'TENANT_FROZEN',
  ].includes(row.errorCode ?? '') ? row.errorCode : null;
  return replyDraftSummarySchema.parse({
    id: row.id, conversationId: row.conversationId, anchorMessageId: row.anchorMessageId,
    triggerSource: row.triggerSource, availableAt: row.availableAt.toISOString(),
    status: row.status, outcome: row.outcome, generatedText: row.generatedText,
    finalText: row.finalText, sources: row.sourceSnapshot ?? [], errorCode: safeError,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  });
}
