import { createHash, randomUUID } from 'node:crypto';
import { deliverySenderProfileInputSchema, isUkrposhtaPersonName, shipmentDraftInputSchema, ukrposhtaConnectionInputSchema, type ShipmentCreateJob, type ShipmentStatus, type UkrposhtaConnectionInput } from '@autosale/contracts';
import type { Prisma, PrismaClient } from '@autosale/database';
import { parseUkrposhtaLocationRef, UkrposhtaError, type UkrposhtaClient, type UkrposhtaLifecycle, type UkrposhtaShipment } from '@autosale/integrations';

type Client = Pick<UkrposhtaClient, 'createAddress' | 'findClientByExternalId' | 'createClient' | 'createShipment' | 'getShipment' | 'getShipmentByBarcode' | 'getLifecycle' | 'cancelShipment'>;
type Candidate = Prisma.ShipmentAttemptGetPayload<{ include: { shipment: { include: { connection: true } } } }>;
type Metadata = {
  environment?: string; credentialGenerationId?: string;
  senderAddressId?: number; recipientAddressId?: number; senderUuid?: string; recipientUuid?: string;
  createDispatched?: boolean; shipmentUuid?: string; barcode?: string;
  deleteDispatched?: boolean;
  parcels?: UkrposhtaShipment['parcels']; lifecycle?: UkrposhtaLifecycle;
};
type CreateResult = 'CREATED' | 'RETRY' | 'UNKNOWN' | 'FAILED' | 'IGNORED';
const leaseMs = 60_000;

export class UkrposhtaShipmentService {
  private readonly now: () => Date;
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clientFactory: (credentials: UkrposhtaConnectionInput) => Client,
    private readonly decrypt: (encrypted: string) => string,
    private readonly options: { enabled: boolean; now?: () => Date },
  ) { this.now = options.now ?? (() => new Date()); }

  async process(job: ShipmentCreateJob): Promise<CreateResult> {
    const candidate = await this.candidate(job, 'CREATE');
    if (!candidate || candidate.shipment.status !== 'CREATING') return 'IGNORED';
    const leaseId = await this.claim(candidate);
    if (!leaseId) return 'IGNORED';
    const metadata = this.metadata(candidate);
    try {
      const credentials = this.credentials(candidate, metadata);
      // A dispatched intent stays active even when credentials or rollout configuration change.
      if (metadata.createDispatched || candidate.status === 'UNKNOWN') {
        const client = this.clientFactory(credentials);
        if (metadata.shipmentUuid || candidate.shipment.providerDocumentId) {
          const result = await client.getShipment(metadata.shipmentUuid ?? candidate.shipment.providerDocumentId!);
          return await this.succeed(candidate, leaseId, metadata, result);
        }
        if (metadata.barcode || candidate.shipment.trackingNumber) {
          const result = await client.getShipmentByBarcode(metadata.barcode ?? candidate.shipment.trackingNumber!);
          return await this.succeed(candidate, leaseId, metadata, result);
        }
        return await this.finish(candidate, leaseId, 'UNKNOWN', 'UKRPOSHTA_OUTCOME_UNKNOWN');
      }
      if (!this.options.enabled || credentials.environment !== 'SANDBOX') return await this.finish(candidate, leaseId, 'FAILED', 'UKRPOSHTA_CREATION_DISABLED');
      const sender = deliverySenderProfileInputSchema.parse(candidate.shipment.senderSnapshot);
      const draft = shipmentDraftInputSchema.parse({ provider: 'UKRPOSHTA', recipient: candidate.shipment.recipientSnapshot, destination: candidate.shipment.destinationSnapshot, parcels: candidate.shipment.parcels, payer: candidate.shipment.payer, declaredValue: Number(candidate.shipment.declaredValue), codAmount: candidate.shipment.codAmount === null ? null : Number(candidate.shipment.codAmount), description: candidate.shipment.description });
      if (sender.origin.type !== 'BRANCH' || draft.destination.type !== 'BRANCH') throw new UkrposhtaError('VALIDATION', null);
      const senderPostcode = parseUkrposhtaLocationRef(sender.origin.locationRef).postcode;
      const recipientPostcode = parseUkrposhtaLocationRef(draft.destination.locationRef).postcode;
      const senderName = individualName(sender.senderRef, draft.codAmount !== null && draft.codAmount > 0);
      const recipientName = individualName(draft.recipient.name, false);
      const client = this.clientFactory(credentials);
      for (const role of ['sender', 'recipient'] as const) {
        const uuidKey = role === 'sender' ? 'senderUuid' : 'recipientUuid';
        const addressKey = role === 'sender' ? 'senderAddressId' : 'recipientAddressId';
        if (metadata[uuidKey] && metadata[addressKey]) continue;
        const externalId = createHash('sha256').update(`autosale:${candidate.tenantId}:${candidate.shipmentId}:${candidate.version}:${credentials.environment}:${metadata.credentialGenerationId}:${role}`).digest('hex');
        await this.checkpoint(candidate, leaseId, metadata);
        const existing = await client.findClientByExternalId(externalId);
        if (existing) {
          metadata[uuidKey] = existing.uuid; metadata[addressKey] = existing.addressId;
        } else {
          if (!metadata[addressKey]) {
            const address = await client.createAddress(role === 'sender' ? senderPostcode : recipientPostcode);
            metadata[addressKey] = address.id;
            await this.checkpoint(candidate, leaseId, metadata);
          }
          const remote = await client.createClient({ ...(role === 'sender' ? senderName : recipientName), phone: role === 'sender' ? sender.contactPhone : draft.recipient.phone, addressId: metadata[addressKey]!, externalId });
          metadata[uuidKey] = remote.uuid;
        }
        await this.checkpoint(candidate, leaseId, metadata);
      }
      // Commit this marker BEFORE POST. No retry path can cross it a second time.
      metadata.createDispatched = true;
      await this.checkpoint(candidate, leaseId, metadata);
      let result: UkrposhtaShipment;
      try {
        result = await client.createShipment({ senderUuid: metadata.senderUuid!, recipientUuid: metadata.recipientUuid!, senderAddressId: metadata.senderAddressId!, recipientAddressId: metadata.recipientAddressId!, senderPostcode, recipientPostcode, parcel: draft.parcels[0]!, payer: draft.payer, declaredValue: draft.declaredValue, codAmount: draft.codAmount, description: draft.description, clientRef: candidate.shipmentId });
      } catch (error) {
        // A definitive rejection is not an ambiguous delivery outcome. Keep this attempt terminal,
        // including 429: a manager can start a new reviewed intent, never replay this POST.
        if (error instanceof UkrposhtaError && ['VALIDATION', 'UNAUTHORIZED', 'NOT_FOUND', 'RATE_LIMITED', 'CREATION_DISABLED'].includes(error.code)) {
          return await this.finish(candidate, leaseId, 'FAILED', `UKRPOSHTA_${error.code}`);
        }
        throw error;
      }
      metadata.shipmentUuid = result.uuid; metadata.barcode = result.barcode;
      await this.checkpoint(candidate, leaseId, metadata);
      return await this.succeed(candidate, leaseId, metadata, result);
    } catch (error) {
      if (error instanceof LostLease) return 'IGNORED';
      if (metadata.createDispatched || candidate.status === 'UNKNOWN') return await this.finish(candidate, leaseId, 'UNKNOWN', 'UKRPOSHTA_OUTCOME_UNKNOWN');
      const code = error instanceof UkrposhtaError ? `UKRPOSHTA_${error.code}` : error instanceof ConnectionChanged ? 'UKRPOSHTA_CONNECTION_CHANGED' : 'UKRPOSHTA_INVALID_DRAFT';
      const retryable = error instanceof UkrposhtaError && ['TIMEOUT', 'NETWORK', 'PROVIDER_ERROR', 'RATE_LIMITED'].includes(error.code) && candidate.attempts < 4;
      return await this.finish(candidate, leaseId, retryable ? 'RETRYABLE' : 'FAILED', code);
    }
  }

  async cancel(job: ShipmentCreateJob): Promise<'CANCELLED' | 'RETRY' | 'IGNORED'> {
    const candidate = await this.candidate(job, 'CANCEL');
    if (!candidate?.shipment.providerDocumentId || candidate.shipment.status === 'CANCELLED') return 'IGNORED';
    const leaseId = await this.claim(candidate);
    if (!leaseId) return 'IGNORED';
    const metadata = this.metadata(candidate);
    try {
      const client = this.clientFactory(this.credentials(candidate, metadata));
      const lifecycle = await client.getLifecycle(candidate.shipment.providerDocumentId);
      metadata.lifecycle = lifecycle;
      if (lifecycle.status !== 'CREATED') {
        await this.completeCancellation(candidate, leaseId, metadata, mapLifecycle(lifecycle.status), 'UKRPOSHTA_LIFECYCLE_CONFLICT');
        return 'IGNORED';
      }
      metadata.deleteDispatched = true;
      await this.checkpoint(candidate, leaseId, metadata);
      await client.cancelShipment(candidate.shipment.providerDocumentId);
      await this.completeCancellation(candidate, leaseId, metadata, 'CANCELLED', null);
      return 'CANCELLED';
    } catch (error) {
      if (error instanceof LostLease) return 'IGNORED';
      if (metadata.deleteDispatched && error instanceof UkrposhtaError && error.code === 'NOT_FOUND') {
        await this.completeCancellation(candidate, leaseId, metadata, 'CANCELLED', null);
        return 'CANCELLED';
      }
      const retryable = error instanceof UkrposhtaError && ['TIMEOUT', 'NETWORK', 'PROVIDER_ERROR', 'RATE_LIMITED'].includes(error.code);
      const code = error instanceof UkrposhtaError ? `UKRPOSHTA_${error.code}` : 'UKRPOSHTA_CONNECTION_CHANGED';
      await this.prisma.$transaction(async (tx) => {
        const owned = await tx.shipmentAttempt.updateMany({ where: { id: candidate.id, tenantId: candidate.tenantId, status: 'PROCESSING', leaseId }, data: { status: retryable ? 'RETRYABLE' : 'FAILED', completedAt: retryable ? null : this.now(), leaseId: null, leaseExpiresAt: null, nextAttemptAt: new Date(this.now().getTime() + 60_000), lastErrorCode: code } });
        if (owned.count === 1 && !retryable) await tx.shipment.update({ where: { id: candidate.shipmentId, tenantId: candidate.tenantId }, data: { lastErrorCode: code } });
      });
      return retryable ? 'RETRY' : 'IGNORED';
    }
  }

  private candidate(job: ShipmentCreateJob, operation: 'CREATE' | 'CANCEL') {
    return this.prisma.shipmentAttempt.findFirst({ where: { shipmentId: job.shipmentId, operation, shipment: { provider: 'UKRPOSHTA' }, OR: [{ status: { in: ['PENDING', 'RETRYABLE', 'UNKNOWN'] }, nextAttemptAt: { lte: this.now() } }, { status: 'PROCESSING', leaseExpiresAt: { lte: this.now() } }] }, orderBy: { version: 'desc' }, include: { shipment: { include: { connection: true } } } });
  }
  private async claim(candidate: Candidate): Promise<string | null> {
    const leaseId = randomUUID();
    const result = await this.prisma.shipmentAttempt.updateMany({ where: { id: candidate.id, tenantId: candidate.tenantId, status: candidate.status, leaseId: candidate.leaseId, ...(candidate.status === 'PROCESSING' ? { leaseExpiresAt: { lte: this.now() } } : {}) }, data: { status: 'PROCESSING', leaseId, leaseExpiresAt: new Date(this.now().getTime() + leaseMs), attempts: { increment: 1 }, lastAttemptAt: this.now() } });
    return result.count === 1 ? leaseId : null;
  }
  private metadata(candidate: Candidate): Metadata {
    const value = candidate.shipment.providerMetadata;
    return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } as Metadata : {};
  }
  private credentials(candidate: Candidate, metadata: Metadata): UkrposhtaConnectionInput {
    try {
      const credentials = ukrposhtaConnectionInputSchema.parse(JSON.parse(this.decrypt(candidate.shipment.connection.encryptedCredential)));
      if (candidate.shipment.connection.status !== 'ACTIVE' || metadata.environment !== credentials.environment || metadata.credentialGenerationId !== candidate.shipment.connection.credentialGenerationId) throw new ConnectionChanged();
      return credentials;
    } catch { throw new ConnectionChanged(); }
  }
  private async checkpoint(candidate: Candidate, leaseId: string, metadata: Metadata): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const owned = await tx.shipmentAttempt.updateMany({ where: { id: candidate.id, tenantId: candidate.tenantId, status: 'PROCESSING', leaseId, leaseExpiresAt: { gt: this.now() } }, data: { leaseExpiresAt: new Date(this.now().getTime() + leaseMs) } });
      if (owned.count !== 1) throw new LostLease();
      await tx.shipment.update({ where: { id: candidate.shipmentId, tenantId: candidate.tenantId }, data: { providerMetadata: JSON.parse(JSON.stringify(metadata)) } });
    });
  }
  private async succeed(candidate: Candidate, leaseId: string, metadata: Metadata, result: UkrposhtaShipment): Promise<CreateResult> {
    const at = this.now();
    return this.prisma.$transaction(async (tx) => {
      const owned = await tx.shipmentAttempt.updateMany({ where: { id: candidate.id, tenantId: candidate.tenantId, status: 'PROCESSING', leaseId }, data: { status: 'SUCCEEDED', completedAt: at, leaseId: null, leaseExpiresAt: null, lastErrorCode: null } });
      if (owned.count !== 1) return 'IGNORED';
      const status = mapLifecycle(result.lifecycle.status);
      await tx.shipment.update({ where: { id: candidate.shipmentId, tenantId: candidate.tenantId }, data: { status, providerDocumentId: result.uuid, trackingNumber: result.barcode, cost: result.deliveryPrice, providerCreatedAt: at, nextStatusCheckAt: terminal(status) ? null : new Date(at.getTime() + 15 * 60_000), lastProviderCode: result.lifecycle.status, lastStatusCheckedAt: at, lastErrorCode: null, providerMetadata: JSON.parse(JSON.stringify({ ...metadata, shipmentUuid: result.uuid, barcode: result.barcode, parcels: result.parcels, lifecycle: result.lifecycle })) } });
      await tx.shipmentStatusEvent.create({ data: { tenantId: candidate.tenantId, shipmentId: candidate.shipmentId, status, providerCode: result.lifecycle.status, occurredAt: at } });
      return 'CREATED';
    });
  }
  private async finish(candidate: Candidate, leaseId: string, status: 'UNKNOWN' | 'FAILED' | 'RETRYABLE', code: string): Promise<CreateResult> {
    return this.prisma.$transaction(async (tx) => {
      const owned = await tx.shipmentAttempt.updateMany({ where: { id: candidate.id, tenantId: candidate.tenantId, status: 'PROCESSING', leaseId }, data: { status, lastErrorCode: code, leaseId: null, leaseExpiresAt: null, completedAt: status === 'FAILED' ? this.now() : null, nextAttemptAt: new Date(this.now().getTime() + (status === 'UNKNOWN' ? 15 * 60_000 : 60_000)) } });
      if (owned.count !== 1) return 'IGNORED';
      await tx.shipment.update({ where: { id: candidate.shipmentId, tenantId: candidate.tenantId }, data: { status: status === 'FAILED' ? 'FAILED' : 'CREATING', lastErrorCode: code } });
      return status === 'RETRYABLE' ? 'RETRY' : status;
    });
  }
  private async completeCancellation(candidate: Candidate, leaseId: string, metadata: Metadata, status: ShipmentStatus, code: string | null): Promise<void> {
    if (status === 'CANCELLED' && code === null) metadata.lifecycle = { status: 'DELETED', statusDate: this.now().toISOString().slice(0, 19) };
    await this.prisma.$transaction(async (tx) => {
      const owned = await tx.shipmentAttempt.updateMany({ where: { id: candidate.id, tenantId: candidate.tenantId, status: 'PROCESSING', leaseId }, data: { status: code ? 'FAILED' : 'SUCCEEDED', completedAt: this.now(), leaseId: null, leaseExpiresAt: null, lastErrorCode: code } });
      if (owned.count !== 1) throw new LostLease();
      await tx.shipment.update({ where: { id: candidate.shipmentId, tenantId: candidate.tenantId }, data: { status, ...(status === 'CANCELLED' ? { cancelledAt: this.now() } : {}), nextStatusCheckAt: null, lastErrorCode: code, lastProviderCode: status === 'CANCELLED' ? 'DELETED' : metadata.lifecycle?.status ?? null, providerMetadata: JSON.parse(JSON.stringify(metadata)), version: { increment: 1 } } });
      await tx.shipmentStatusEvent.create({ data: { tenantId: candidate.tenantId, shipmentId: candidate.shipmentId, status, providerCode: status === 'CANCELLED' ? 'DELETED' : metadata.lifecycle!.status, occurredAt: this.now() } });
    });
  }
}

function individualName(name: string, middleRequired: boolean) {
  const [lastName, firstName, ...middle] = name.trim().split(/\s+/);
  if (!isUkrposhtaPersonName(name, middleRequired)) throw new UkrposhtaError('VALIDATION', null);
  return { lastName: lastName!, firstName: firstName!, ...(middle.length ? { middleName: middle.join(' ') } : {}) };
}
function mapLifecycle(status: UkrposhtaLifecycle['status']): ShipmentStatus {
  switch (status) {
    case 'CREATED': return 'CREATED'; case 'REGISTERED': return 'ACCEPTED';
    case 'DELIVERED': return 'DELIVERED'; case 'RETURNING': return 'RETURNING'; case 'RETURNED': return 'RETURNED';
    case 'DELETED': case 'CANCELED': return 'CANCELLED'; default: return 'IN_TRANSIT';
  }
}
function terminal(status: ShipmentStatus): boolean {
  return ['DELIVERED', 'RETURNED', 'CANCELLED', 'FAILED'].includes(status);
}
class LostLease extends Error {}
class ConnectionChanged extends Error {}
