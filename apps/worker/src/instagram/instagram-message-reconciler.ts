import type { PrismaClient } from '@autosale/database';

interface InstagramMessageQueue {
  add(
    name: 'instagram.message.send',
    data: { tenantId: string; messageId: string },
    options: { jobId: string; attempts: 1; removeOnComplete: true; removeOnFail: true },
  ): Promise<unknown>;
}

export class InstagramMessageReconciler {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly queue: InstagramMessageQueue,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async reconcile(): Promise<{ attempted: number; queued: number }> {
    const now = this.now();
    const messages = await this.prisma.$queryRaw<Array<{ tenant_id: string; message_id: string }>>`
      SELECT tenant_id, message_id
      FROM public.worker_due_instagram_messages(${now}, 50)
    `;

    let queued = 0;
    for (const message of messages) {
      try {
        await this.queue.add(
          'instagram.message.send',
          { tenantId: message.tenant_id, messageId: message.message_id },
          { jobId: message.message_id, attempts: 1, removeOnComplete: true, removeOnFail: true },
        );
        queued += 1;
      } catch {
        // The next reconciliation pass safely retries this queue wake-up.
      }
    }
    return { attempted: messages.length, queued };
  }
}
