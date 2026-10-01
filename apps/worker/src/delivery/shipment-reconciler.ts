import { createHash } from 'node:crypto';

import { type PrismaClient, withTenantTransaction } from '@autosale/database';

interface DeliveryQueue {
  add(name: 'shipment.create' | 'shipment.status.sync' | 'shipment.cancel' | 'shipment.status.sync.ukrposhta', data: { shipmentId: string } | { shipmentIds: string[] }, options: {
    jobId: string; attempts: 1; removeOnComplete: true; removeOnFail: true;
  }): Promise<unknown>;
}

type DueRow = { tenant_id: string; shipment_id: string; version: number };
type LoadedShipment = {
  id: string; tenantId: string; provider: 'NOVA_POSHTA' | 'MEEST' | 'UKRPOSHTA'; connectionId: string;
  version: number; requestHash: string; providerMetadata: unknown;
};

export class ShipmentReconciler {
  constructor(private readonly prisma: PrismaClient, private readonly queue: DeliveryQueue, private readonly now: () => Date = () => new Date()) {}

  async reconcile(): Promise<{ attempted: number; queued: number }> {
    const now = this.now();
    const attempts = await this.dueAttempts(now, 'CREATE');
    let queued = 0;
    for (const attempt of attempts) {
      try {
        await this.queue.add('shipment.create', { shipmentId: attempt.shipment_id }, {
          jobId: `shipment:create:${attempt.shipment_id}:${attempt.version}`, attempts: 1, removeOnComplete: true, removeOnFail: true,
        });
        queued += 1;
      } catch { /* the next reconciliation pass retries */ }
    }

    const standardRows = await this.dueStatuses(now, 'STANDARD', 50);
    const ukrposhtaRows = await this.dueStatuses(now, 'UKRPOSHTA', 250);
    const shipments: LoadedShipment[] = [];
    for (const row of [...standardRows, ...ukrposhtaRows]) {
      const shipment = await withTenantTransaction(this.prisma, row.tenant_id, async (transaction) => {
        const current = await transaction.shipment.findFirst({
          where: {
            id: row.shipment_id, tenantId: row.tenant_id, version: row.version,
            status: { in: ['CREATED', 'ACCEPTED', 'IN_TRANSIT', 'RETURNING'] },
            trackingNumber: { not: null }, nextStatusCheckAt: { lte: now },
          },
          select: { id: true, tenantId: true, provider: true, connectionId: true, version: true, requestHash: true, providerMetadata: true },
        });
        if (!current) return null;
        const idempotencyKey = `shipment:status:v1:${current.id}:${current.version}`;
        await transaction.shipmentAttempt.upsert({
          where: { tenantId_shipmentId_operation_version: { tenantId: current.tenantId, shipmentId: current.id, operation: 'STATUS_SYNC', version: current.version } },
          create: { tenantId: current.tenantId, shipmentId: current.id, operation: 'STATUS_SYNC', version: current.version, status: 'PENDING', idempotencyKey, requestHash: current.requestHash },
          update: {},
        });
        return current;
      });
      if (shipment) shipments.push(shipment);
    }

    const ukrposhtaGroups = new Map<string, LoadedShipment[]>();
    for (const shipment of shipments) {
      if (shipment.provider === 'UKRPOSHTA') {
        const metadata = shipment.providerMetadata && typeof shipment.providerMetadata === 'object' && !Array.isArray(shipment.providerMetadata)
          ? shipment.providerMetadata as Record<string, unknown> : {};
        const key = [shipment.tenantId, shipment.connectionId, String(metadata.environment ?? ''), String(metadata.credentialGenerationId ?? '')].join(':');
        const group = ukrposhtaGroups.get(key) ?? [];
        group.push(shipment);
        ukrposhtaGroups.set(key, group);
      } else {
        try {
          await this.queue.add('shipment.status.sync', { shipmentId: shipment.id }, {
            jobId: `shipment:status:${shipment.id}:${shipment.version}`, attempts: 1, removeOnComplete: true, removeOnFail: true,
          });
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
          await this.queue.add('shipment.status.sync.ukrposhta', { shipmentIds }, {
            jobId: `shipment:status:ukrposhta:${identity}`, attempts: 1, removeOnComplete: true, removeOnFail: true,
          });
          queued += 1;
        } catch { /* retry on next pass */ }
      }
    }

    const cancellations = await this.dueAttempts(now, 'CANCEL');
    for (const attempt of cancellations) {
      try {
        await this.queue.add('shipment.cancel', { shipmentId: attempt.shipment_id }, {
          jobId: `shipment:cancel:${attempt.shipment_id}:${attempt.version}`, attempts: 1, removeOnComplete: true, removeOnFail: true,
        });
        queued += 1;
      } catch { /* retry on next pass */ }
    }
    return { attempted: attempts.length + shipments.length + cancellations.length, queued };
  }

  private dueAttempts(now: Date, operation: 'CREATE' | 'CANCEL'): Promise<DueRow[]> {
    return this.prisma.$queryRaw<DueRow[]>`
      SELECT tenant_id, shipment_id, version
      FROM public.worker_due_shipment_attempts(${now}, ${operation}, ${50})
    `;
  }

  private dueStatuses(now: Date, providerGroup: 'STANDARD' | 'UKRPOSHTA', limit: number): Promise<DueRow[]> {
    return this.prisma.$queryRaw<DueRow[]>`
      SELECT tenant_id, shipment_id, version
      FROM public.worker_due_shipment_statuses(${now}, ${providerGroup}, ${limit})
    `;
  }
}
