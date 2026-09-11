import { randomUUID } from 'node:crypto';

import { deliverySenderProfileInputSchema, shipmentDraftInputSchema, type ShipmentCreateJob } from '@autosale/contracts';
import type { PrismaClient } from '@autosale/database';
import { NovaPoshtaError, type NovaPoshtaCreatedShipment, type NovaPoshtaShipmentInput, type NovaPoshtaShipmentReference } from '@autosale/integrations';

const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 5;

interface ShipmentClient {
  createShipment(input: NovaPoshtaShipmentInput): Promise<NovaPoshtaCreatedShipment>;
  findShipmentByClientRef(clientRef: string): Promise<NovaPoshtaShipmentReference | null>;
}

export type ShipmentCreateResult = 'CREATED' | 'RETRY' | 'UNKNOWN' | 'FAILED' | 'IGNORED';

export class ShipmentCreateService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clientFactory: (encryptedCredential: string) => ShipmentClient,
    private readonly decrypt: (encryptedCredential: string) => string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async process(job: ShipmentCreateJob): Promise<ShipmentCreateResult> {
    const startedAt = this.now();
    const leaseId = randomUUID();
    const candidate = await this.prisma.shipmentAttempt.findFirst({
      where: {
        shipmentId: job.shipmentId,
        operation: 'CREATE',
        OR: [
          { status: { in: ['PENDING', 'RETRYABLE', 'UNKNOWN'] }, nextAttemptAt: { lte: startedAt } },
          { status: 'PROCESSING', leaseExpiresAt: { lte: startedAt } },
        ],
      },
      orderBy: { version: 'desc' },
      include: { shipment: { include: { connection: true } } },
    });
    if (!candidate || candidate.shipment.status !== 'CREATING') return 'IGNORED';

    const claimed = await this.prisma.shipmentAttempt.updateMany({
      where: {
        id: candidate.id,
        status: candidate.status,
        ...(candidate.leaseId ? { leaseId: candidate.leaseId } : { leaseId: null }),
      },
      data: {
        status: 'PROCESSING', leaseId, leaseExpiresAt: new Date(startedAt.getTime() + LEASE_MS),
        lastAttemptAt: startedAt, attempts: { increment: 1 }, lastErrorCode: null,
      },
    });
    if (claimed.count !== 1) return 'IGNORED';

    const clientRef = `shipment:${candidate.shipment.id}:${candidate.version}`;
    const client = this.clientFactory(this.decrypt(candidate.shipment.connection.encryptedCredential));
    try {
      if (candidate.status === 'UNKNOWN') {
        const existing = await client.findShipmentByClientRef(clientRef);
        if (existing) return await this.succeed(candidate.id, candidate.shipment.id, leaseId, existing, null, startedAt);
      }
      const created = await client.createShipment(providerInput(candidate.shipment, clientRef));
      return await this.succeed(candidate.id, candidate.shipment.id, leaseId, created, created.cost, startedAt);
    } catch (error) {
      if (error instanceof NovaPoshtaError && ['TIMEOUT', 'NETWORK', 'PROVIDER_ERROR'].includes(error.code)) {
        return await this.finish(candidate.id, candidate.shipment.id, leaseId, 'UNKNOWN', 'NOVA_POSHTA_OUTCOME_UNKNOWN', startedAt, 60_000);
      }
      if (error instanceof NovaPoshtaError && error.code === 'RATE_LIMITED' && candidate.attempts + 1 < MAX_ATTEMPTS) {
        const delay = Math.min(15 * 60_000, 30_000 * 2 ** candidate.attempts);
        return await this.finish(candidate.id, candidate.shipment.id, leaseId, 'RETRYABLE', 'NOVA_POSHTA_RATE_LIMITED', startedAt, delay);
      }
      const code = error instanceof NovaPoshtaError ? `NOVA_POSHTA_${error.code}` : 'SHIPMENT_CREATE_FAILED';
      return await this.finish(candidate.id, candidate.shipment.id, leaseId, 'FAILED', code, startedAt, 0);
    }
  }

  private async succeed(
    attemptId: string,
    shipmentId: string,
    leaseId: string,
    result: NovaPoshtaCreatedShipment | NovaPoshtaShipmentReference,
    cost: number | null,
    completedAt: Date,
  ): Promise<ShipmentCreateResult> {
    return this.prisma.$transaction(async (tx) => {
      const attempt = await tx.shipmentAttempt.updateMany({
        where: { id: attemptId, status: 'PROCESSING', leaseId },
        data: { status: 'SUCCEEDED', completedAt, leaseId: null, leaseExpiresAt: null, lastErrorCode: null },
      });
      if (attempt.count !== 1) return 'IGNORED';
      await tx.shipment.update({ where: { id: shipmentId }, data: {
        status: 'CREATED', providerDocumentId: result.documentRef, trackingNumber: result.trackingNumber,
        ...(cost === null ? {} : { cost }), providerCreatedAt: completedAt, lastErrorCode: null,
      } });
      await tx.shipmentStatusEvent.create({ data: {
        tenantId: (await tx.shipment.findUniqueOrThrow({ where: { id: shipmentId }, select: { tenantId: true } })).tenantId,
        shipmentId, status: 'CREATED', providerCode: 'CREATED', occurredAt: completedAt,
      } });
      return 'CREATED';
    });
  }

  private async finish(
    attemptId: string,
    shipmentId: string,
    leaseId: string,
    status: 'RETRYABLE' | 'UNKNOWN' | 'FAILED',
    errorCode: string,
    at: Date,
    delayMs: number,
  ): Promise<ShipmentCreateResult> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const attempt = await tx.shipmentAttempt.updateMany({
        where: { id: attemptId, status: 'PROCESSING', leaseId },
        data: {
          status, lastErrorCode: errorCode, nextAttemptAt: new Date(at.getTime() + delayMs),
          completedAt: status === 'FAILED' ? at : null, leaseId: null, leaseExpiresAt: null,
        },
      });
      if (attempt.count !== 1) return false;
      await tx.shipment.update({ where: { id: shipmentId }, data: {
        status: status === 'FAILED' ? 'FAILED' : 'CREATING', lastErrorCode: errorCode,
      } });
      return true;
    });
    if (!updated) return 'IGNORED';
    return status === 'RETRYABLE' ? 'RETRY' : status;
  }
}

function providerInput(shipment: {
  senderSnapshot: unknown; recipientSnapshot: unknown; destinationSnapshot: unknown; parcels: unknown;
  payer: 'SENDER' | 'RECIPIENT'; declaredValue: unknown; codAmount: unknown; description: string;
}, clientRef: string): NovaPoshtaShipmentInput {
  const sender = deliverySenderProfileInputSchema.parse(shipment.senderSnapshot);
  const draft = shipmentDraftInputSchema.parse({
    provider: 'NOVA_POSHTA', recipient: shipment.recipientSnapshot, destination: shipment.destinationSnapshot,
    parcels: shipment.parcels, payer: shipment.payer, declaredValue: Number(shipment.declaredValue),
    codAmount: shipment.codAmount === null ? null : Number(shipment.codAmount), description: shipment.description,
  });
  if (sender.origin.type === 'ADDRESS' || draft.destination.type === 'ADDRESS') throw new NovaPoshtaError('VALIDATION', null);
  return {
    sender: { cityRef: sender.origin.cityRef, locationRef: sender.origin.locationRef, counterpartyRef: sender.senderRef, contactRef: sender.contactRef, phone: sender.contactPhone },
    recipient: {
      name: draft.recipient.name, phone: draft.recipient.phone, cityRef: draft.destination.cityRef,
      cityLabel: draft.destination.label, locationRef: draft.destination.locationRef,
      locationNumber: draft.destination.label.match(/\d+/)?.[0] ?? '1',
    },
    parcel: draft.parcels[0]!, payer: draft.payer, declaredValue: draft.declaredValue,
    codAmount: draft.codAmount, description: draft.description, clientRef,
  };
}
