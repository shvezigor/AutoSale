import { createHash, randomUUID } from 'node:crypto';

import { ukrposhtaConnectionInputSchema, ukrposhtaTrackingBatchJobSchema, type ShipmentStatus, type UkrposhtaConnectionInput, type UkrposhtaTrackingBatchJob } from '@autosale/contracts';
import type { Prisma, PrismaClient } from '@autosale/database';
import { UkrposhtaError, UkrposhtaTrackingError, type UkrposhtaLifecycle, type UkrposhtaTrackingBatchResult } from '@autosale/integrations';

type TrackingContext = {
  lifecycle: { getLifecycle(id: string): Promise<UkrposhtaLifecycle> };
  tracking: { getLastStatuses(barcodes: string[]): Promise<UkrposhtaTrackingBatchResult> };
};
type Candidate = Prisma.ShipmentAttemptGetPayload<{ include: { shipment: { include: { connection: true } } } }>;
type Metadata = { environment?: string; credentialGenerationId?: string; lifecycle?: UkrposhtaLifecycle };

const leaseMs = 60_000;
const mappingVersion = 1;
const createdDelayMs = 15 * 60_000;
const trackingDelayMs = 30 * 60_000;

class LostTrackingRace extends Error {}

export function mapUkrposhtaTrackingStatus(code: string, reasonCode: string | null): ShipmentStatus | null {
  if (code === '41000' && reasonCode === '10') return 'RETURNED';
  if (['41000', '48000', '5001', '5002'].includes(code)) return 'DELIVERED';
  if (code === '31200') return 'RETURNING';
  if (['10600', '10602', '10603'].includes(code)) return 'CANCELLED';
  if (code === '10601') return 'CREATED';
  if (code === '10100') return 'ACCEPTED';
  if (['20700', '20800', '20900', '21500', '21700', '31100', '31300', '31400', '21400'].includes(code)) return 'IN_TRANSIT';
  return null;
}

export class UkrposhtaTrackingService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clientFactory: (credentials: UkrposhtaConnectionInput) => TrackingContext,
    private readonly decrypt: (encrypted: string) => string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async processBatch(input: UkrposhtaTrackingBatchJob): Promise<'UPDATED' | 'RETRY' | 'IGNORED'> {
    const job = ukrposhtaTrackingBatchJobSchema.parse(input);
    const now = this.now();
    const candidates = await this.prisma.shipmentAttempt.findMany({
      where: {
        shipmentId: { in: job.shipmentIds }, operation: 'STATUS_SYNC',
        OR: [
          { status: { in: ['PENDING', 'RETRYABLE'] }, nextAttemptAt: { lte: now } },
          { status: 'PROCESSING', leaseExpiresAt: { lte: now } },
        ],
        shipment: { provider: 'UKRPOSHTA', status: { in: ['CREATED', 'ACCEPTED', 'IN_TRANSIT', 'RETURNING'] }, trackingNumber: { not: null } },
      },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }], take: 50,
      include: { shipment: { include: { connection: true } } },
    });
    if (!candidates.length || !oneCredentialGroup(candidates)) return 'IGNORED';

    const claimed: Array<{ candidate: Candidate; leaseId: string }> = [];
    for (const candidate of candidates) {
      const leaseId = randomUUID();
      const owned = await this.prisma.shipmentAttempt.updateMany({
        where: {
          id: candidate.id, tenantId: candidate.tenantId, status: candidate.status, leaseId: candidate.leaseId,
          ...(candidate.status === 'PROCESSING' ? { leaseExpiresAt: { lte: now } } : {}),
        },
        data: { status: 'PROCESSING', leaseId, leaseExpiresAt: new Date(now.getTime() + leaseMs), attempts: { increment: 1 }, lastAttemptAt: now },
      });
      if (owned.count === 1) claimed.push({ candidate, leaseId });
    }
    if (!claimed.length) return 'IGNORED';

    let credentials: UkrposhtaConnectionInput;
    try { credentials = credentialsFor(claimed[0]!.candidate, this.decrypt); }
    catch {
      await Promise.all(claimed.map(({ candidate, leaseId }) => this.fail(candidate, leaseId, 'UKRPOSHTA_CONNECTION_CHANGED', false)));
      return 'IGNORED';
    }
    const context = this.clientFactory(credentials);
    const trackable: Array<{ candidate: Candidate; leaseId: string; metadata: Metadata }> = [];
    let updated = 0;
    let retried = 0;

    for (const claimedItem of claimed) {
      const metadata = metadataOf(claimedItem.candidate);
      try {
        if (metadata.lifecycle?.status === 'CREATED') {
          const identifier = claimedItem.candidate.shipment.providerDocumentId ?? claimedItem.candidate.shipment.trackingNumber!;
          metadata.lifecycle = await context.lifecycle.getLifecycle(identifier);
          if (metadata.lifecycle.status === 'CREATED') {
            if (await this.completeWithoutEvent(claimedItem.candidate, claimedItem.leaseId, metadata, 'CREATED', createdDelayMs)) updated += 1;
            continue;
          }
        }
        trackable.push({ ...claimedItem, metadata });
      } catch (error) {
        await this.fail(claimedItem.candidate, claimedItem.leaseId, safeErrorCode(error), retryable(error));
        retried += retryable(error) ? 1 : 0;
      }
    }

    if (trackable.length) {
      let result: UkrposhtaTrackingBatchResult;
      try {
        result = await context.tracking.getLastStatuses(trackable.map(({ candidate }) => candidate.shipment.trackingNumber!));
      } catch (error) {
        await Promise.all(trackable.map(({ candidate, leaseId }) => this.fail(candidate, leaseId, safeErrorCode(error), retryable(error))));
        return retryable(error) ? 'RETRY' : updated ? 'UPDATED' : 'IGNORED';
      }
      const found = new Map<string, UkrposhtaTrackingBatchResult['found']>();
      for (const event of result.found) {
        const events = found.get(event.barcode) ?? [];
        events.push(event);
        found.set(event.barcode, events);
      }
      const notFound = new Set(result.notFound);
      for (const item of trackable) {
        const barcode = item.candidate.shipment.trackingNumber!;
        const events = found.get(barcode);
        if (!events && notFound.has(barcode)) {
          const lifecycleStatus = statusFromLifecycle(item.metadata.lifecycle?.status);
          if (await this.completeWithoutEvent(item.candidate, item.leaseId, item.metadata, advance(item.candidate.shipment.status, lifecycleStatus), trackingDelayMs)) updated += 1;
          continue;
        }
        if (!events) {
          await this.fail(item.candidate, item.leaseId, 'UKRPOSHTA_TRACKING_INVALID_RESPONSE', false);
          continue;
        }
        if (await this.completeWithEvents(item.candidate, item.leaseId, item.metadata, events)) updated += 1;
      }
    }
    return updated ? 'UPDATED' : retried ? 'RETRY' : 'IGNORED';
  }

  private async completeWithoutEvent(candidate: Candidate, leaseId: string, metadata: Metadata, status: ShipmentStatus, delayMs: number): Promise<boolean> {
    const now = this.now();
    const accepted = candidate.shipment.acceptedAt === null && status !== 'CREATED' && status !== 'CANCELLED';
    try {
      return await this.prisma.$transaction(async (tx) => {
        const shipment = await tx.shipment.updateMany({
          where: { id: candidate.shipmentId, tenantId: candidate.tenantId, version: candidate.shipment.version, status: candidate.shipment.status },
          data: {
            status, providerMetadata: json(metadata), lastProviderCode: metadata.lifecycle?.status ?? candidate.shipment.lastProviderCode,
            lastStatusCheckedAt: now, nextStatusCheckAt: terminal(status) ? null : new Date(now.getTime() + delayMs),
            ...(accepted ? { acceptedAt: now } : {}),
            lastErrorCode: null, version: { increment: 1 },
          },
        });
        if (shipment.count !== 1) return false;
        const owned = await tx.shipmentAttempt.updateMany({ where: { id: candidate.id, tenantId: candidate.tenantId, status: 'PROCESSING', leaseId }, data: { status: 'SUCCEEDED', completedAt: now, leaseId: null, leaseExpiresAt: null, lastErrorCode: null } });
        if (owned.count !== 1) throw new LostTrackingRace();
        return true;
      });
    } catch (error) {
      if (error instanceof LostTrackingRace) return false;
      throw error;
    }
  }

  private async completeWithEvents(candidate: Candidate, leaseId: string, metadata: Metadata, events: UkrposhtaTrackingBatchResult['found']): Promise<boolean> {
    const now = this.now();
    const ordered = [...events].sort(compareEvents);
    const lifecycleStatus = statusFromLifecycle(metadata.lifecycle?.status);
    let next = advance(candidate.shipment.status, lifecycleStatus);
    let acceptedAt: Date | null = candidate.shipment.acceptedAt;
    let deliveredAt: Date | null = candidate.shipment.deliveredAt;
    for (const event of ordered) {
      const mapped = mapUkrposhtaTrackingStatus(event.providerCode, event.providerReasonCode);
      const advanced = advance(next, mapped);
      if (acceptedAt === null && advanced !== 'CREATED' && advanced !== 'CANCELLED') acceptedAt = event.occurredAt;
      if (deliveredAt === null && advanced === 'DELIVERED') deliveredAt = event.occurredAt;
      next = advanced;
    }
    const latest = ordered.at(-1)!;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const shipment = await tx.shipment.updateMany({
          where: { id: candidate.shipmentId, tenantId: candidate.tenantId, version: candidate.shipment.version, status: candidate.shipment.status },
          data: {
            status: next, providerMetadata: json(metadata), lastProviderCode: latest.providerCode,
            lastStatusCheckedAt: now, nextStatusCheckAt: terminal(next) ? null : new Date(now.getTime() + trackingDelayMs),
            ...(candidate.shipment.acceptedAt === null && acceptedAt !== null ? { acceptedAt } : {}),
            ...(candidate.shipment.deliveredAt === null && deliveredAt !== null ? { deliveredAt } : {}),
            lastErrorCode: null, version: { increment: 1 },
          },
        });
        if (shipment.count !== 1) return false;
        const owned = await tx.shipmentAttempt.updateMany({ where: { id: candidate.id, tenantId: candidate.tenantId, status: 'PROCESSING', leaseId }, data: { status: 'SUCCEEDED', completedAt: now, leaseId: null, leaseExpiresAt: null, lastErrorCode: null } });
        if (owned.count !== 1) throw new LostTrackingRace();
        for (const event of ordered) {
          const mapped = mapUkrposhtaTrackingStatus(event.providerCode, event.providerReasonCode);
          const providerEventKey = eventKey(event);
          await tx.shipmentStatusEvent.upsert({
            where: { tenantId_shipmentId_providerEventKey: { tenantId: candidate.tenantId, shipmentId: candidate.shipmentId, providerEventKey } },
            create: { tenantId: candidate.tenantId, shipmentId: candidate.shipmentId, status: mapped, providerCode: event.providerCode, providerEventKey, providerOccurredAt: event.occurredAt, rawSnapshot: json(event.raw), mappingVersion, occurredAt: now },
            update: {},
          });
        }
        return true;
      });
    } catch (error) {
      if (error instanceof LostTrackingRace) return false;
      throw error;
    }
  }

  private async fail(candidate: Candidate, leaseId: string, code: string, canRetry: boolean): Promise<void> {
    const now = this.now();
    const delay = Math.min(6 * 60 * 60_000, 5 * 60_000 * 2 ** Math.min(candidate.attempts, 6));
    const retryAt = new Date(now.getTime() + delay);
    await this.prisma.$transaction(async (tx) => {
      const owned = await tx.shipmentAttempt.updateMany({ where: { id: candidate.id, tenantId: candidate.tenantId, status: 'PROCESSING', leaseId }, data: {
        status: canRetry ? 'RETRYABLE' : 'FAILED', nextAttemptAt: retryAt, completedAt: canRetry ? null : now,
        leaseId: null, leaseExpiresAt: null, lastErrorCode: code,
      } });
      if (owned.count !== 1) return;
      await tx.shipment.update({ where: { id: candidate.shipmentId, tenantId: candidate.tenantId }, data: { lastErrorCode: code, nextStatusCheckAt: canRetry ? retryAt : null } });
    });
  }
}

function credentialsFor(candidate: Candidate, decrypt: (encrypted: string) => string): UkrposhtaConnectionInput {
  const metadata = metadataOf(candidate);
  const credentials = ukrposhtaConnectionInputSchema.parse(JSON.parse(decrypt(candidate.shipment.connection.encryptedCredential)));
  if (candidate.shipment.connection.status !== 'ACTIVE' || metadata.environment !== credentials.environment || metadata.credentialGenerationId !== candidate.shipment.connection.credentialGenerationId) throw new Error('connection changed');
  return credentials;
}
function metadataOf(candidate: Candidate): Metadata {
  const value = candidate.shipment.providerMetadata;
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } as Metadata : {};
}
function oneCredentialGroup(candidates: Candidate[]): boolean {
  const keys = new Set(candidates.map((candidate) => {
    const metadata = metadataOf(candidate);
    return [candidate.tenantId, candidate.shipment.connection.id, candidate.shipment.connection.credentialGenerationId, metadata.environment, metadata.credentialGenerationId].join(':');
  }));
  return keys.size === 1;
}
function eventKey(event: UkrposhtaTrackingBatchResult['found'][number]): string {
  const step = typeof event.raw.step === 'number' || typeof event.raw.step === 'string' ? String(event.raw.step) : '';
  return createHash('sha256').update([event.barcode, step, event.providerCode, event.providerReasonCode ?? '', event.occurredAt.toISOString()].join(':')).digest('hex');
}
function compareEvents(left: UkrposhtaTrackingBatchResult['found'][number], right: UkrposhtaTrackingBatchResult['found'][number]): number {
  const leftStep = Number(left.raw.step);
  const rightStep = Number(right.raw.step);
  if (Number.isFinite(leftStep) && Number.isFinite(rightStep) && leftStep !== rightStep) return leftStep - rightStep;
  return left.occurredAt.getTime() - right.occurredAt.getTime();
}
function advance(current: ShipmentStatus, mapped: ShipmentStatus | null): ShipmentStatus {
  if (!mapped || terminal(current)) return current;
  if (current === 'CREATED') return mapped;
  if (current === 'ACCEPTED') return mapped === 'CREATED' ? current : mapped;
  if (current === 'IN_TRANSIT') return ['DELIVERED', 'RETURNING', 'RETURNED', 'CANCELLED'].includes(mapped) ? mapped : current;
  if (current === 'RETURNING') return mapped === 'RETURNED' ? mapped : current;
  return current;
}
function terminal(status: ShipmentStatus): boolean { return ['DELIVERED', 'RETURNED', 'CANCELLED', 'FAILED'].includes(status); }
function statusFromLifecycle(status: UkrposhtaLifecycle['status'] | undefined): ShipmentStatus | null {
  switch (status) {
    case 'CREATED': return 'CREATED';
    case 'REGISTERED': return 'ACCEPTED';
    case 'DELIVERED': return 'DELIVERED';
    case 'RETURNING': return 'RETURNING';
    case 'RETURNED': return 'RETURNED';
    case 'DELETED': case 'CANCELED': return 'CANCELLED';
    case undefined: return null;
    default: return 'IN_TRANSIT';
  }
}
function retryable(error: unknown): boolean {
  return error instanceof UkrposhtaTrackingError
    ? ['RATE_LIMITED', 'TIMEOUT', 'NETWORK', 'PROVIDER_ERROR'].includes(error.code)
    : error instanceof UkrposhtaError && ['RATE_LIMITED', 'TIMEOUT', 'NETWORK', 'PROVIDER_ERROR'].includes(error.code);
}
function safeErrorCode(error: unknown): string {
  if (error instanceof UkrposhtaTrackingError) return `UKRPOSHTA_TRACKING_${error.code}`;
  if (error instanceof UkrposhtaError) return `UKRPOSHTA_ECOM_${error.code}`;
  return 'UKRPOSHTA_TRACKING_FAILED';
}
function json(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }
