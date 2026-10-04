import type { PrismaClient } from '@autosale/database';

interface TikTokMessageQueue {
  add(
    name: 'tiktok.message.send',
    data: { tenantId: string; messageId: string },
    options: { jobId: string; attempts: 1; removeOnComplete: true; removeOnFail: true },
  ): Promise<unknown>;
}

export class TikTokMessageReconciler {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly queue: TikTokMessageQueue,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async reconcile(): Promise<{ attempted: number; queued: number; markedUnknown: number }> {
    const now = this.now();
    const unknown = await this.prisma.$queryRaw<Array<{ marked_unknown: number | bigint }>>`
      SELECT public.worker_mark_stale_tiktok_messages_unknown(${now}, 50) AS marked_unknown
    `;
    const messages = await this.prisma.$queryRaw<Array<{ tenant_id: string; message_id: string }>>`
      SELECT tenant_id, message_id
      FROM public.worker_due_tiktok_messages(${now}, 50)
    `;

    let queued = 0;
    for (const message of messages) {
      try {
        await this.queue.add(
          'tiktok.message.send',
          { tenantId: message.tenant_id, messageId: message.message_id },
          { jobId: message.message_id, attempts: 1, removeOnComplete: true, removeOnFail: true },
        );
        queued += 1;
      } catch {
        // The PENDING row remains eligible for the next safe wake-up pass.
      }
    }
    return {
      attempted: messages.length,
      queued,
      markedUnknown: Number(unknown[0]?.marked_unknown ?? 0),
    };
  }
}
