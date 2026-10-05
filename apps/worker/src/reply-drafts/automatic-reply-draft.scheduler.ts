import { randomUUID } from 'node:crypto';

import {
  assertTenantAcceptingMutations,
  Prisma,
  type PrismaClient,
  withTenantTransaction,
} from '@autosale/database';

export const AUTOMATIC_REPLY_QUIET_PERIOD_MS = 10_000;

interface ReplyDraftQueue {
  add(
    name: 'ai-replies.generate',
    data: { tenantId: string; draftId: string },
    options: { jobId: string; delay: number; attempts: 1; removeOnComplete: true; removeOnFail: true },
  ): Promise<unknown>;
}

type ScheduleResult = 'SCHEDULED' | 'REPLAYED' | 'SKIPPED';

export class AutomaticReplyDraftScheduler {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly queue: ReplyDraftQueue,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async schedule(tenantId: string, messageId: string): Promise<ScheduleResult> {
    const now = this.now();
    let scheduled: { id: string; availableAt: Date; replayed: boolean } | null;
    try {
      scheduled = await withTenantTransaction(this.prisma, tenantId, async (tx) => {
        await assertTenantAcceptingMutations(tx, tenantId, 'CONVERSATION_REPLY');
        const message = await tx.message.findFirst({
          where: { id: messageId, tenantId, direction: 'INBOUND' },
          select: { id: true, conversationId: true, text: true },
        });
        if (!message?.text?.trim()) return null;

        const style = await tx.tenantReplyStyle.findUnique({
          where: { tenantId }, select: { enabled: true },
        });
        if (!style?.enabled) return null;

        const latest = await tx.message.findFirst({
          where: { tenantId, conversationId: message.conversationId, direction: 'INBOUND' },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { id: true },
        });
        if (latest?.id !== message.id) return null;

        const replay = await tx.aiReplyDraft.findFirst({
          where: {
            tenantId,
            conversationId: message.conversationId,
            anchorMessageId: message.id,
            idempotencyKey: message.id,
            triggerSource: 'AUTOMATIC',
          },
        });
        if (replay) return { id: replay.id, availableAt: replay.availableAt, replayed: true };

        await tx.aiReplyDraft.updateMany({
          where: {
            tenantId,
            conversationId: message.conversationId,
            anchorMessageId: { not: message.id },
            status: { in: ['QUEUED', 'PROCESSING', 'READY'] },
          },
          data: { status: 'STALE', errorCode: 'NEW_MESSAGE', leaseId: null, leaseExpiresAt: null },
        });

        const since = new Date(now.getTime() - 60_000);
        const [tenantCount, activeTenantCount] = await Promise.all([
          tx.aiReplyDraft.count({ where: { tenantId, createdAt: { gte: since } } }),
          tx.aiReplyDraft.count({ where: { tenantId, status: { in: ['QUEUED', 'PROCESSING'] } } }),
        ]);
        if (tenantCount >= 30 || activeTenantCount >= 3) return null;

        const availableAt = new Date(now.getTime() + AUTOMATIC_REPLY_QUIET_PERIOD_MS);
        const draft = await tx.aiReplyDraft.create({ data: {
          id: randomUUID(),
          tenantId,
          conversationId: message.conversationId,
          anchorMessageId: message.id,
          createdByUserId: null,
          idempotencyKey: message.id,
          triggerSource: 'AUTOMATIC',
          availableAt,
        } });
        return { id: draft.id, availableAt: draft.availableAt, replayed: false };
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      scheduled = await withTenantTransaction(this.prisma, tenantId, async (tx) => {
        const draft = await tx.aiReplyDraft.findFirst({
          where: { tenantId, anchorMessageId: messageId, idempotencyKey: messageId, triggerSource: 'AUTOMATIC' },
        });
        return draft ? { id: draft.id, availableAt: draft.availableAt, replayed: true } : null;
      });
      if (!scheduled) throw error;
    }

    if (!scheduled) return 'SKIPPED';
    const delay = Math.max(0, scheduled.availableAt.getTime() - now.getTime());
    try {
      await this.queue.add('ai-replies.generate', { tenantId, draftId: scheduled.id }, {
        jobId: `ai-reply-${scheduled.id}`,
        delay,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      });
    } catch {
      // The durable QUEUED row remains discoverable by the bounded reconciler.
    }
    return scheduled.replayed ? 'REPLAYED' : 'SCHEDULED';
  }
}
