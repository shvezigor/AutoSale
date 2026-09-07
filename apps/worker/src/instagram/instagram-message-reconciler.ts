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
    const messages = await this.prisma.message.findMany({
      where: {
        direction: 'OUTBOUND',
        OR: [
          { deliveryStatus: 'PENDING', nextDeliveryAttemptAt: { lte: now } },
          { deliveryStatus: 'SENDING', deliveryLeaseExpiresAt: { lte: now } },
        ],
      },
      orderBy: [{ nextDeliveryAttemptAt: 'asc' }, { createdAt: 'asc' }],
      take: 50,
      select: { id: true, tenantId: true },
    });

    let queued = 0;
    for (const message of messages) {
      try {
        await this.queue.add(
          'instagram.message.send',
          { tenantId: message.tenantId, messageId: message.id },
          { jobId: message.id, attempts: 1, removeOnComplete: true, removeOnFail: true },
        );
        queued += 1;
      } catch {
        // The next reconciliation pass safely retries this queue wake-up.
      }
    }
    return { attempted: messages.length, queued };
  }
}
