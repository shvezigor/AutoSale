import type { PrismaClient } from '@autosale/database';

interface ReplyQueue {
  add(name: 'ai-replies.generate', data: { tenantId: string; draftId: string },
    options: { jobId: string; delay: number; attempts: 1; removeOnComplete: true; removeOnFail: true }): Promise<unknown>;
}

export class ReplyDraftReconciler {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly queue: ReplyQueue,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async reconcile(): Promise<{ expiredFailed: number; attempted: number; queued: number }> {
    const now = this.now();
    const [expiredFailed, due] = await Promise.all([
      this.prisma.$queryRaw<Array<{ worker_fail_expired_ai_reply_drafts: number }>>`
        SELECT public.worker_fail_expired_ai_reply_drafts(${now}, 50)
      `,
      this.prisma.$queryRaw<Array<{ tenant_id: string; draft_id: string; available_at: Date }>>`
        SELECT tenant_id, draft_id, available_at FROM public.worker_due_ai_reply_drafts(${now}, 50)
      `,
    ]);
    let queued = 0;
    for (const row of due) {
      try {
        await this.queue.add('ai-replies.generate', { tenantId: row.tenant_id, draftId: row.draft_id }, {
          jobId: `ai-reply-${row.draft_id}`,
          delay: Math.max(0, row.available_at.getTime() - now.getTime()),
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: true,
        });
        queued += 1;
      } catch {
        // PostgreSQL keeps the durable request for the next bounded scan.
      }
    }
    return { expiredFailed: expiredFailed[0]?.worker_fail_expired_ai_reply_drafts ?? 0, attempted: due.length, queued };
  }
}
