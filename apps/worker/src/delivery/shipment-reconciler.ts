import { createHash } from 'node:crypto';

import type { ShipmentStatus } from '@autosale/contracts';
import type { PrismaClient } from '@autosale/database';

interface DeliveryQueue {
  add(name: 'shipment.create' | 'shipment.status.sync' | 'shipment.cancel' | 'shipment.status.sync.ukrposhta', data: { shipmentId: string } | { shipmentIds: string[] }, options: {
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
    const trackableStatuses: ShipmentStatus[] = ['CREATED', 'ACCEPTED', 'IN_TRANSIT', 'RETURNING'];
    const dueWhere = { status: { in: trackableStatuses }, trackingNumber: { not: null }, nextStatusCheckAt: { lte: now } };
    const select = { id: true, tenantId: true, provider: true, connectionId: true, version: true, requestHash: true, providerMetadata: true } as const;
    const standardShipments = await this.prisma.shipment.findMany({
      where: { ...dueWhere, provider: { not: 'UKRPOSHTA' } },
      orderBy: { nextStatusCheckAt: 'asc' }, take: 50,
      select,
    });
    const ukrposhtaShipments = await this.prisma.shipment.findMany({
      where: { ...dueWhere, provider: 'UKRPOSHTA' },
      orderBy: { nextStatusCheckAt: 'asc' }, take: 250,
      select,
    });
    const shipments = [...standardShipments, ...ukrposhtaShipments];
    const ukrposhtaGroups = new Map<string, typeof shipments>();
    for (const shipment of shipments) {
      const idempotencyKey = `shipment:status:v1:${shipment.id}:${shipment.version}`;
      await this.prisma.shipmentAttempt.upsert({
        where: { tenantId_shipmentId_operation_version: { tenantId: shipment.tenantId, shipmentId: shipment.id, operation: 'STATUS_SYNC', version: shipment.version } },
        create: { tenantId: shipment.tenantId, shipmentId: shipment.id, operation: 'STATUS_SYNC', version: shipment.version, status: 'PENDING', idempotencyKey, requestHash: shipment.requestHash },
        update: {},
      });
      if (shipment.provider === 'UKRPOSHTA') {
        const metadata = shipment.providerMetadata && typeof shipment.providerMetadata === 'object' && !Array.isArray(shipment.providerMetadata)
          ? shipment.providerMetadata as Record<string, unknown> : {};
        const key = [shipment.tenantId, shipment.connectionId, String(metadata.environment ?? ''), String(metadata.credentialGenerationId ?? '')].join(':');
        const group = ukrposhtaGroups.get(key) ?? [];
        group.push(shipment); ukrposhtaGroups.set(key, group);
      } else {
        try {
          await this.queue.add('shipment.status.sync', { shipmentId: shipment.id }, { jobId: `shipment:status:${shipment.id}:${shipment.version}`, attempts: 1, removeOnComplete: true, removeOnFail: true });
          queued += 1;
        } catch { /* retry on next pass */ }
      }
    }
    for (const group of ukrposhtaGroups.values()) {
      for (let index = 0; index < group.length; index += 50) {
        const batch = group.slice(index, index + 50);
        const shipmentIds = batch.map((shipment) => shipment.id);
        const identity = createHash('sha256').update(batch.map((shipment) => `${shipment.id}:${shipment.version}`).join('|')).digest('hex').slice(0, 32);
        try {
          await this.queue.add('shipment.status.sync.ukrposhta', { shipmentIds }, { jobId: `shipment:status:ukrposhta:${identity}`, attempts: 1, removeOnComplete: true, removeOnFail: true });
          queued += 1;
        } catch { /* retry on next pass */ }
      }
    }
    const cancellations = await this.prisma.shipmentAttempt.findMany({
      where: { operation: 'CANCEL', OR: [{ status: { in: ['PENDING', 'RETRYABLE'] }, nextAttemptAt: { lte: now } }, { status: 'PROCESSING', leaseExpiresAt: { lte: now } }] },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }], take: 50, select: { shipmentId: true, version: true },
    });
    for (const attempt of cancellations) {
      try {
        await this.queue.add('shipment.cancel', { shipmentId: attempt.shipmentId }, { jobId: `shipment:cancel:${attempt.shipmentId}:${attempt.version}`, attempts: 1, removeOnComplete: true, removeOnFail: true });
        queued += 1;
      } catch { /* retry on next pass */ }
    }
    return { attempted: attempts.length + shipments.length + cancellations.length, queued };
  }
}
