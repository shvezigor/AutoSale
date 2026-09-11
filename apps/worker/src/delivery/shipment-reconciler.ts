import type { PrismaClient } from '@autosale/database';

interface DeliveryQueue {
  add(name: 'shipment.create', data: { shipmentId: string }, options: {
    jobId: string; attempts: 1; removeOnComplete: true; removeOnFail: true;
  }): Promise<unknown>;
}

export class ShipmentReconciler {
  constructor(private readonly prisma: PrismaClient, private readonly queue: DeliveryQueue, private readonly now: () => Date = () => new Date()) {}

  async reconcile(): Promise<{ attempted: number; queued: number }> {
    const now = this.now();
    const attempts = await this.prisma.shipmentAttempt.findMany({
      where: {
        operation: 'CREATE',
        shipment: { status: 'CREATING' },
        OR: [
          { status: { in: ['PENDING', 'RETRYABLE', 'UNKNOWN'] }, nextAttemptAt: { lte: now } },
          { status: 'PROCESSING', leaseExpiresAt: { lte: now } },
        ],
      },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }], take: 50,
      select: { shipmentId: true, version: true },
    });
    let queued = 0;
    for (const attempt of attempts) {
      try {
        await this.queue.add('shipment.create', { shipmentId: attempt.shipmentId }, {
          jobId: `shipment:create:${attempt.shipmentId}:${attempt.version}`, attempts: 1, removeOnComplete: true, removeOnFail: true,
        });
        queued += 1;
      } catch { /* the next reconciliation pass retries */ }
    }
    return { attempted: attempts.length, queued };
  }
}
