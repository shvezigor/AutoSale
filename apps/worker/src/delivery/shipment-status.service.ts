import { randomUUID } from 'node:crypto';

import type { ShipmentStatus, ShipmentStatusJob } from '@autosale/contracts';
import { assertTenantAcceptingMutations, type PrismaClient, TenantLifecycleFrozenError, withTenantTransaction } from '@autosale/database';
import { NovaPoshtaError, type NovaPoshtaShipmentStatus } from '@autosale/integrations';
import { resolveShipmentTenant } from './delivery-authority.js';

const LEASE_MS = 60_000;

interface StatusClient { getShipmentStatus(tracking: string): Promise<NovaPoshtaShipmentStatus>; cancelShipment(documentRef: string): Promise<{ cancelled: true }> }

export function mapNovaPoshtaStatus(code: string): ShipmentStatus | null {
  if (['1', '2', '3'].includes(code)) return 'CREATED';
  if (['4', '5', '6', '7', '8', '12', '101', '102', '103', '104'].includes(code)) return 'IN_TRANSIT';
  if (['9', '10', '11'].includes(code)) return 'DELIVERED';
  if (['105', '106'].includes(code)) return 'RETURNING';
  if (['107', '108'].includes(code)) return 'RETURNED';
  return null;
}

export class ShipmentStatusService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clientFactory: (apiKey: string) => StatusClient,
    private readonly decrypt: (encrypted: string) => string,
    private readonly now: () => Date = () => new Date(),
    private readonly ukrposhta?: { cancel(job: ShipmentStatusJob): Promise<'CANCELLED' | 'RETRY' | 'IGNORED' | 'IGNORED_FROZEN'> },
  ) {}

  async process(job: ShipmentStatusJob): Promise<'UPDATED' | 'RETRY' | 'IGNORED'> {
    const now = this.now();
    const leaseId = randomUUID();
    const tenantId = await resolveShipmentTenant(this.prisma, job.shipmentId);
    if (!tenantId) return 'IGNORED';
    const attempt = await withTenantTransaction(this.prisma, tenantId, (transaction) => transaction.shipmentAttempt.findFirst({
      where: { shipmentId: job.shipmentId, operation: 'STATUS_SYNC', status: { in: ['PENDING', 'RETRYABLE'] }, nextAttemptAt: { lte: now } },
      orderBy: { version: 'desc' }, include: { shipment: { include: { connection: true } } },
    }));
    if (!attempt?.shipment.trackingNumber || terminal(attempt.shipment.status)) return 'IGNORED';
    if (attempt.shipment.provider === 'UKRPOSHTA') return 'IGNORED';
    const claimed = await withTenantTransaction(this.prisma, tenantId, (transaction) => transaction.shipmentAttempt.updateMany({
      where: { id: attempt.id, status: attempt.status, leaseId: null },
      data: { status: 'PROCESSING', leaseId, leaseExpiresAt: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 }, lastAttemptAt: now },
    }));
    if (claimed.count !== 1) return 'IGNORED';
    try {
      const provider = await this.clientFactory(this.decrypt(attempt.shipment.connection.encryptedCredential)).getShipmentStatus(attempt.shipment.trackingNumber);
      const mapped = mapNovaPoshtaStatus(provider.providerCode);
      const next = mapped ?? attempt.shipment.status;
      await withTenantTransaction(this.prisma, tenantId, async (tx) => {
        const completed = await tx.shipmentAttempt.updateMany({ where: { id: attempt.id, status: 'PROCESSING', leaseId }, data: { status: 'SUCCEEDED', completedAt: now, leaseId: null, leaseExpiresAt: null } });
        if (completed.count !== 1) return;
        const last = await tx.shipmentStatusEvent.findFirst({ where: { tenantId: attempt.tenantId, shipmentId: attempt.shipmentId }, orderBy: { occurredAt: 'desc' }, select: { providerCode: true } });
        if (last?.providerCode !== provider.providerCode) await tx.shipmentStatusEvent.create({ data: { tenantId: attempt.tenantId, shipmentId: attempt.shipmentId, status: mapped, providerCode: provider.providerCode, occurredAt: now } });
        await tx.shipment.update({ where: { id: attempt.shipmentId }, data: {
          status: next, lastProviderCode: provider.providerCode, lastStatusCheckedAt: now,
          nextStatusCheckAt: terminal(next) ? null : new Date(now.getTime() + 15 * 60_000),
          ...(next === 'DELIVERED' ? { deliveredAt: now } : {}), version: { increment: 1 }, lastErrorCode: null,
        } });
      });
      return 'UPDATED';
    } catch (error) {
      const retryable = !(error instanceof NovaPoshtaError) || ['RATE_LIMITED', 'TIMEOUT', 'NETWORK', 'PROVIDER_ERROR'].includes(error.code);
      await withTenantTransaction(this.prisma, tenantId, (transaction) => transaction.shipmentAttempt.updateMany({ where: { id: attempt.id, status: 'PROCESSING', leaseId }, data: {
        status: retryable ? 'RETRYABLE' : 'FAILED', nextAttemptAt: new Date(now.getTime() + 60_000),
        completedAt: retryable ? null : now, leaseId: null, leaseExpiresAt: null,
        lastErrorCode: error instanceof NovaPoshtaError ? `NOVA_POSHTA_${error.code}` : 'SHIPMENT_STATUS_FAILED',
      } }));
      return retryable ? 'RETRY' : 'IGNORED';
    }
  }

  async cancel(job: ShipmentStatusJob): Promise<'CANCELLED' | 'RETRY' | 'IGNORED' | 'IGNORED_FROZEN'> {
    const now = this.now();
    const leaseId = randomUUID();
    const tenantId = await resolveShipmentTenant(this.prisma, job.shipmentId);
    if (!tenantId) return 'IGNORED';
    const attempt = await withTenantTransaction(this.prisma, tenantId, (transaction) => transaction.shipmentAttempt.findFirst({
      where: { shipmentId: job.shipmentId, operation: 'CANCEL', status: { in: ['PENDING', 'RETRYABLE'] }, nextAttemptAt: { lte: now } },
      orderBy: { version: 'desc' }, include: { shipment: { include: { connection: true } } },
    }));
    if (!attempt?.shipment.providerDocumentId || attempt.shipment.status === 'CANCELLED') return 'IGNORED';
    if (attempt.shipment.provider === 'UKRPOSHTA') return this.ukrposhta ? this.ukrposhta.cancel(job) : 'IGNORED';
    const claimed = await withTenantTransaction(this.prisma, tenantId, async (transaction) => {
      try {
        await assertTenantAcceptingMutations(transaction, tenantId, 'DELIVERY');
      } catch (error) {
        if (!(error instanceof TenantLifecycleFrozenError)) throw error;
        const owned = await transaction.shipmentAttempt.updateMany({
          where: { id: attempt.id, status: attempt.status, leaseId: null },
          data: { status: 'FAILED', completedAt: now, leaseId: null, leaseExpiresAt: null, lastErrorCode: error.code },
        });
        if (owned.count === 1) {
          await transaction.shipment.updateMany({ where: { id: attempt.shipmentId, tenantId }, data: { lastErrorCode: error.code } });
        }
        return 'FROZEN' as const;
      }
      return transaction.shipmentAttempt.updateMany({ where: { id: attempt.id, status: attempt.status, leaseId: null }, data: { status: 'PROCESSING', leaseId, leaseExpiresAt: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 }, lastAttemptAt: now } });
    });
    if (claimed === 'FROZEN') return 'IGNORED_FROZEN';
    if (claimed.count !== 1) return 'IGNORED';
    try {
      await this.clientFactory(this.decrypt(attempt.shipment.connection.encryptedCredential)).cancelShipment(attempt.shipment.providerDocumentId);
      await withTenantTransaction(this.prisma, tenantId, async (tx) => {
        const completed = await tx.shipmentAttempt.updateMany({ where: { id: attempt.id, status: 'PROCESSING', leaseId }, data: { status: 'SUCCEEDED', completedAt: now, leaseId: null, leaseExpiresAt: null } });
        if (completed.count !== 1) return;
        await tx.shipment.update({ where: { id: attempt.shipmentId }, data: { status: 'CANCELLED', cancelledAt: now, nextStatusCheckAt: null, lastErrorCode: null, version: { increment: 1 } } });
        await tx.shipmentStatusEvent.create({ data: { tenantId: attempt.tenantId, shipmentId: attempt.shipmentId, status: 'CANCELLED', providerCode: 'CANCELLED_BY_MANAGER', occurredAt: now } });
      });
      return 'CANCELLED';
    } catch (error) {
      const retryable = !(error instanceof NovaPoshtaError) || ['RATE_LIMITED', 'TIMEOUT', 'NETWORK', 'PROVIDER_ERROR'].includes(error.code);
      await withTenantTransaction(this.prisma, tenantId, (transaction) => transaction.shipmentAttempt.updateMany({ where: { id: attempt.id, status: 'PROCESSING', leaseId }, data: { status: retryable ? 'RETRYABLE' : 'FAILED', nextAttemptAt: new Date(now.getTime() + 60_000), completedAt: retryable ? null : now, leaseId: null, leaseExpiresAt: null, lastErrorCode: error instanceof NovaPoshtaError ? `NOVA_POSHTA_${error.code}` : 'SHIPMENT_CANCEL_FAILED' } }));
      return retryable ? 'RETRY' : 'IGNORED';
    }
  }
}

function terminal(status: string): boolean {
  return ['DELIVERED', 'RETURNED', 'CANCELLED', 'FAILED'].includes(status);
}
