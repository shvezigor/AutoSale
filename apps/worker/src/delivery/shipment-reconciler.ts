import type { PrismaClient } from '@autosale/database';

interface DeliveryQueue {
  add(name: 'shipment.create' | 'shipment.status.sync', data: { shipmentId: string }, options: {
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
    const shipments = await this.prisma.shipment.findMany({
      where: { status: { in: ['CREATED', 'ACCEPTED', 'IN_TRANSIT', 'RETURNING'] }, trackingNumber: { not: null }, nextStatusCheckAt: { lte: now } },
      orderBy: { nextStatusCheckAt: 'asc' }, take: 50, select: { id: true, tenantId: true, version: true, requestHash: true },
    });
    for (const shipment of shipments) {
      const idempotencyKey = `shipment:status:v1:${shipment.id}:${shipment.version}`;
      await this.prisma.shipmentAttempt.upsert({
        where: { tenantId_shipmentId_operation_version: { tenantId: shipment.tenantId, shipmentId: shipment.id, operation: 'STATUS_SYNC', version: shipment.version } },
        create: { tenantId: shipment.tenantId, shipmentId: shipment.id, operation: 'STATUS_SYNC', version: shipment.version, status: 'PENDING', idempotencyKey, requestHash: shipment.requestHash },
        update: {},
      });
      try {
        await this.queue.add('shipment.status.sync', { shipmentId: shipment.id }, { jobId: `shipment:status:${shipment.id}:${shipment.version}`, attempts: 1, removeOnComplete: true, removeOnFail: true });
        queued += 1;
      } catch { /* retry on next pass */ }
    }
    return { attempted: attempts.length + shipments.length, queued };
  }
}
