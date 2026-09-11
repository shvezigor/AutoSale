import { createHash, randomUUID } from 'node:crypto';

import { deliverySenderProfileInputSchema, shipmentDraftInputSchema, type DeliveryConnectionInput, type DeliveryConnectionSummary, type DeliverySenderProfileInput, type ShipmentDraftInput, type ShipmentOverview, type ShipmentQuote, type ShipmentSummary } from '@autosale/contracts';
import type { PrismaClient } from '@autosale/database';
import type { CredentialCipher, NovaPoshtaClient, NovaPoshtaSenderProfile } from '@autosale/integrations';
import { BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

type NovaPoshtaClientPort = Pick<NovaPoshtaClient, 'validateCredential' | 'listSenderProfiles' | 'searchCities' | 'searchLocations' | 'calculateShipment' | 'getLabel'>;
export type NovaPoshtaClientFactory = (apiKey: string) => NovaPoshtaClientPort;

type DeliveryServiceOptions = {
  enabled: boolean;
  now?: () => Date;
};

export interface ShipmentCreateQueue {
  add(name: 'shipment.create', data: { shipmentId: string }, options: {
    jobId: string; attempts: 1; removeOnComplete: true; removeOnFail: true;
  }): Promise<unknown>;
}

export class DeliveryService {
  private readonly now: () => Date;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly cipher: CredentialCipher,
    private readonly novaPoshtaClient: NovaPoshtaClientFactory,
    private readonly options: DeliveryServiceOptions,
    private readonly shipmentQueue?: ShipmentCreateQueue,
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async summary(tenantId: string): Promise<{ enabled: boolean; connections: DeliveryConnectionSummary[] }> {
    if (!this.options.enabled) return { enabled: false, connections: [] };
    const connection = await this.prisma.deliveryConnection.findUnique({
      where: { tenantId_provider: { tenantId, provider: 'NOVA_POSHTA' } },
      include: { senderProfile: true },
    });
    return { enabled: true, connections: connection ? [safeConnection(connection)] : [] };
  }

  async connect(tenantId: string, userId: string, input: DeliveryConnectionInput): Promise<DeliveryConnectionSummary> {
    this.assertEnabled();
    const client = this.novaPoshtaClient(input.apiKey);
    await client.validateCredential();
    const senders = await client.listSenderProfiles();
    const accountLabel = senders[0]?.label ?? null;
    const encryptedCredential = this.cipher.encrypt(input.apiKey);
    const credentialGenerationId = randomUUID();
    const verifiedAt = this.now();
    const connection = await this.prisma.deliveryConnection.upsert({
      where: { tenantId_provider: { tenantId, provider: 'NOVA_POSHTA' } },
      create: {
        tenantId,
        provider: 'NOVA_POSHTA',
        status: 'ACTIVE',
        encryptedCredential,
        credentialGenerationId,
        accountLabel,
        connectedByUserId: userId,
        lastVerifiedAt: verifiedAt,
      },
      update: {
        status: 'ACTIVE',
        encryptedCredential,
        credentialGenerationId,
        accountLabel,
        connectedByUserId: userId,
        lastVerifiedAt: verifiedAt,
        lastErrorCode: null,
        disconnectedAt: null,
      },
      include: { senderProfile: true },
    });
    return safeConnection(connection);
  }

  async senderProfile(tenantId: string): Promise<DeliverySenderProfileInput | null> {
    if (!this.options.enabled) return null;
    const connection = await this.prisma.deliveryConnection.findUnique({
      where: { tenantId_provider: { tenantId, provider: 'NOVA_POSHTA' } },
      select: { id: true },
    });
    if (!connection) return null;
    const profile = await this.prisma.deliverySenderProfile.findUnique({
      where: { tenantId_connectionId: { tenantId, connectionId: connection.id } },
    });
    return profile ? safeSenderProfile(profile) : null;
  }

  async saveSenderProfile(tenantId: string, input: DeliverySenderProfileInput): Promise<DeliverySenderProfileInput> {
    this.assertEnabled();
    const connection = await this.prisma.deliveryConnection.findUnique({
      where: { tenantId_provider: { tenantId, provider: 'NOVA_POSHTA' } },
      select: { id: true, status: true },
    });
    if (!connection || connection.status !== 'ACTIVE') throw new Error('Active Nova Poshta connection required');
    const data = senderProfileData(input);
    await this.prisma.deliverySenderProfile.upsert({
      where: { tenantId_connectionId: { tenantId, connectionId: connection.id } },
      create: { tenantId, connectionId: connection.id, ...data },
      update: data,
    });
    return input;
  }

  async senderOptions(tenantId: string): Promise<NovaPoshtaSenderProfile[]> {
    const client = await this.clientForTenant(tenantId);
    return client.listSenderProfiles();
  }

  async shipmentOverview(tenantId: string, orderId: string): Promise<ShipmentOverview> {
    this.assertEnabled();
    const order = await this.orderForShipment(tenantId, orderId);
    const readiness = shipmentReadiness(order);
    const shipment = await this.prisma.shipment.findFirst({
      where: { tenantId, orderId },
      orderBy: { createdAt: 'desc' },
      include: { statusEvents: { orderBy: { occurredAt: 'desc' } } },
    });
    const connection = await this.prisma.deliveryConnection.findUnique({
      where: { tenantId_provider: { tenantId, provider: 'NOVA_POSHTA' } },
      include: { senderProfile: true },
    });
    const blockedReason = !readiness.allowed
      ? readiness.reason
      : !connection || connection.status !== 'ACTIVE'
        ? 'CONNECTION_REQUIRED'
        : !connection.senderProfile ? 'SENDER_PROFILE_REQUIRED' : null;
    return {
      shipment: shipment ? mapShipmentSummary(shipment) : null,
      canCreateShipment: blockedReason === null,
      blockedReason,
      draft: blockedReason === null
        ? shipment?.status === 'DRAFT' ? draftFromShipment(shipment) : await this.prefill(order, connection!.senderProfile!)
        : null,
    };
  }

  async saveShipmentDraft(tenantId: string, orderId: string, userId: string, input: ShipmentDraftInput): Promise<ShipmentSummary> {
    this.assertEnabled();
    const order = await this.orderForShipment(tenantId, orderId);
    const readiness = shipmentReadiness(order);
    if (!readiness.allowed) throw new BadRequestException(readiness.reason);
    const parsed = shipmentDraftInputSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException('INVALID_SHIPMENT_DRAFT');
    const connection = await this.prisma.deliveryConnection.findUnique({
      where: { tenantId_provider: { tenantId, provider: 'NOVA_POSHTA' } },
      include: { senderProfile: true },
    });
    if (!connection || connection.status !== 'ACTIVE') throw new BadRequestException('CONNECTION_REQUIRED');
    if (!validSenderProfile(connection.senderProfile)) throw new BadRequestException('SENDER_PROFILE_REQUIRED');
    const data = shipmentDraftData(parsed.data, connection.senderProfile);
    const existing = await this.prisma.shipment.findFirst({
      where: { tenantId, orderId, status: { in: ['DRAFT', 'CREATING', 'CREATED', 'ACCEPTED', 'IN_TRANSIT', 'RETURNING'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (existing && existing.status !== 'DRAFT') throw new BadRequestException('SHIPMENT_ALREADY_CREATED');
    const shipment = existing
      ? await this.prisma.shipment.update({ where: { id: existing.id }, data, include: { statusEvents: { orderBy: { occurredAt: 'desc' } } } })
      : await this.prisma.shipment.create({
          data: {
            tenantId, orderId, connectionId: connection.id, createdByUserId: userId, provider: 'NOVA_POSHTA', status: 'DRAFT',
            ...data, idempotencyKey: `shipment:draft:v1:${orderId}`,
          },
          include: { statusEvents: { orderBy: { occurredAt: 'desc' } } },
        });
    return mapShipmentSummary(shipment);
  }

  async quoteShipment(tenantId: string, orderId: string, input: unknown): Promise<ShipmentQuote> {
    this.assertEnabled();
    const order = await this.orderForShipment(tenantId, orderId);
    const readiness = shipmentReadiness(order);
    if (!readiness.allowed) throw new BadRequestException(readiness.reason);
    const parsed = shipmentDraftInputSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException('INVALID_SHIPMENT_DRAFT');
    const connection = await this.prisma.deliveryConnection.findUnique({
      where: { tenantId_provider: { tenantId, provider: 'NOVA_POSHTA' } },
      include: { senderProfile: true },
    });
    if (!connection || connection.status !== 'ACTIVE') throw new BadRequestException('CONNECTION_REQUIRED');
    if (!validSenderProfile(connection.senderProfile)) throw new BadRequestException('SENDER_PROFILE_REQUIRED');
    const client = this.novaPoshtaClient(this.cipher.decrypt(connection.encryptedCredential));
    return client.calculateShipment(providerShipmentInput(parsed.data, connection.senderProfile, `quote:${orderId}`));
  }

  async createShipment(tenantId: string, orderId: string, userId: string, explicitIdempotencyKey?: string): Promise<ShipmentSummary> {
    this.assertEnabled();
    const order = await this.orderForShipment(tenantId, orderId);
    const readiness = shipmentReadiness(order);
    if (!readiness.allowed) throw new BadRequestException(readiness.reason);

    const active = await this.prisma.shipment.findFirst({
      where: { tenantId, orderId, status: { in: ['DRAFT', 'CREATING', 'CREATED', 'ACCEPTED', 'IN_TRANSIT', 'RETURNING'] } },
      orderBy: { createdAt: 'desc' },
      include: { statusEvents: { orderBy: { occurredAt: 'desc' } } },
    });
    if (!active) throw new BadRequestException('SHIPMENT_DRAFT_REQUIRED');
    if (active.status !== 'DRAFT') return mapShipmentSummary(active);

    const version = active.version;
    const idempotencyKey = explicitIdempotencyKey?.trim() || `shipment:create:v1:${active.id}:${version}`;
    if (idempotencyKey.length > 200) throw new BadRequestException('INVALID_IDEMPOTENCY_KEY');
    const conflictingAttempt = await this.prisma.shipmentAttempt.findUnique({
      where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
      select: { shipmentId: true, requestHash: true },
    });
    if (conflictingAttempt && (conflictingAttempt.shipmentId !== active.id || conflictingAttempt.requestHash !== active.requestHash)) {
      throw new UnprocessableEntityException('IDEMPOTENCY_KEY_REUSED');
    }

    try {
      await this.prisma.$transaction(async (transaction) => {
        const claimed = await transaction.shipment.updateMany({
          where: { id: active.id, tenantId, status: 'DRAFT', version },
          data: { status: 'CREATING', createdByUserId: userId, idempotencyKey, lastErrorCode: null },
        });
        if (claimed.count !== 1) return;
        await transaction.shipmentAttempt.upsert({
          where: { tenantId_shipmentId_operation_version: { tenantId, shipmentId: active.id, operation: 'CREATE', version } },
          create: { tenantId, shipmentId: active.id, operation: 'CREATE', version, status: 'PENDING', idempotencyKey, requestHash: active.requestHash },
          update: {},
        });
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const winner = await this.prisma.shipmentAttempt.findUnique({
        where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
        select: { shipmentId: true, requestHash: true },
      });
      if (!winner) throw error;
      if (winner.shipmentId !== active.id || winner.requestHash !== active.requestHash) {
        throw new UnprocessableEntityException('IDEMPOTENCY_KEY_REUSED');
      }
    }

    try {
      await this.shipmentQueue?.add('shipment.create', { shipmentId: active.id }, {
        jobId: `shipment:create:${active.id}:${version}`, attempts: 1, removeOnComplete: true, removeOnFail: true,
      });
    } catch {
      // PostgreSQL is the source of truth. The reconciler will retry this wake-up.
    }
    const shipment = await this.prisma.shipment.findFirst({
      where: { id: active.id, tenantId }, include: { statusEvents: { orderBy: { occurredAt: 'desc' } } },
    });
    if (!shipment) throw new NotFoundException('Shipment not found');
    return mapShipmentSummary(shipment);
  }

  async shipmentLabel(tenantId: string, shipmentId: string): Promise<{ bytes: Uint8Array; filename: string }> {
    this.assertEnabled();
    const shipment = await this.prisma.shipment.findFirst({
      where: { id: shipmentId, tenantId }, include: { connection: true },
    });
    if (!shipment) throw new NotFoundException('Shipment not found');
    if (!shipment.providerDocumentId || !shipment.trackingNumber || !['CREATED', 'ACCEPTED', 'IN_TRANSIT', 'DELIVERED', 'RETURNING', 'RETURNED'].includes(shipment.status)) {
      throw new BadRequestException('SHIPMENT_LABEL_UNAVAILABLE');
    }
    const client = this.novaPoshtaClient(this.cipher.decrypt(shipment.connection.encryptedCredential));
    const bytes = await client.getLabel(shipment.providerDocumentId);
    if (bytes.byteLength > 10 * 1024 * 1024) throw new BadRequestException('SHIPMENT_LABEL_TOO_LARGE');
    return { bytes, filename: `nova-poshta-${shipment.trackingNumber}.pdf` };
  }

  async disconnect(tenantId: string): Promise<DeliveryConnectionSummary> {
    this.assertEnabled();
    const disconnectedAt = this.now();
    const result = await this.prisma.deliveryConnection.updateMany({
      where: { tenantId, provider: 'NOVA_POSHTA' },
      data: {
        status: 'DISCONNECTED',
        disconnectedAt,
        encryptedCredential: this.cipher.encrypt(randomUUID()),
        credentialGenerationId: randomUUID(),
        lastErrorCode: null,
      },
    });
    if (result.count !== 1) throw new Error('Nova Poshta connection not found');
    return {
      provider: 'NOVA_POSHTA',
      status: 'DISCONNECTED',
      accountLabel: null,
      lastVerifiedAt: null,
      lastErrorCode: null,
      senderProfile: null,
    };
  }

  async clientForTenant(tenantId: string): Promise<NovaPoshtaClientPort> {
    return (await this.clientContextForTenant(tenantId)).client;
  }

  async clientContextForTenant(tenantId: string): Promise<{ client: NovaPoshtaClientPort; credentialGenerationId: string }> {
    this.assertEnabled();
    const connection = await this.prisma.deliveryConnection.findUnique({
      where: { tenantId_provider: { tenantId, provider: 'NOVA_POSHTA' } },
      select: { status: true, encryptedCredential: true, credentialGenerationId: true },
    });
    if (!connection || connection.status !== 'ACTIVE') throw new Error('Active Nova Poshta connection required');
    return {
      client: this.novaPoshtaClient(this.cipher.decrypt(connection.encryptedCredential)),
      credentialGenerationId: connection.credentialGenerationId,
    };
  }

  private assertEnabled(): void {
    if (!this.options.enabled) throw new Error('Nova Poshta delivery is disabled');
  }

  private async orderForShipment(tenantId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  private async prefill(order: Awaited<ReturnType<DeliveryService['orderForShipment']>>, sender: Parameters<typeof safeSenderProfile>[0]) {
    const extraction = (order.extraction ?? {}) as {
      customer?: { name?: string | null; phone?: string | null };
      delivery?: { city?: string | null; novaPoshtaBranch?: string | null; address?: string | null };
    };
    const skus = order.items.map((item) => item.catalogId).filter((value): value is string => Boolean(value));
    const products = await this.prisma.product.findMany({ where: { tenantId: order.tenantId, sku: { in: skus } }, select: { sku: true, name: true, price: true } });
    const bySku = new Map(products.map((product) => [product.sku, product]));
    const declaredValue = order.items.reduce((sum, item) => sum + Number(bySku.get(item.catalogId ?? '')?.price ?? 0) * item.quantity, 0);
    const description = order.items.map((item) => bySku.get(item.catalogId ?? '')?.name ?? item.originalText).filter(Boolean).join(', ').slice(0, 100) || 'Товари';
    const profile = safeSenderProfile(sender);
    return {
      provider: 'NOVA_POSHTA' as const,
      recipient: { name: extraction.customer?.name ?? null, phone: extraction.customer?.phone ?? null },
      cityHint: extraction.delivery?.city ?? null,
      locationHint: extraction.delivery?.novaPoshtaBranch ?? extraction.delivery?.address ?? null,
      parcels: [profile.defaultParcel],
      payer: profile.payer,
      declaredValue: declaredValue > 0 ? declaredValue : 1,
      codAmount: null,
      description,
    };
  }
}

function shipmentDraftData(draft: ShipmentDraftInput, sender: Parameters<typeof safeSenderProfile>[0]) {
  const requestHash = createHash('sha256').update(JSON.stringify(draft)).digest('hex');
  return {
    senderSnapshot: JSON.parse(JSON.stringify(safeSenderProfile(sender))),
    recipientSnapshot: draft.recipient,
    destinationSnapshot: draft.destination,
    parcels: draft.parcels,
    payer: draft.payer,
    declaredValue: draft.declaredValue,
    codAmount: draft.codAmount,
    description: draft.description,
    requestHash,
  };
}

function draftFromShipment(shipment: {
  provider: 'NOVA_POSHTA' | 'MEEST' | 'UKRPOSHTA'; recipientSnapshot: unknown; destinationSnapshot: unknown;
  parcels: unknown; payer: 'SENDER' | 'RECIPIENT'; declaredValue: unknown; codAmount: unknown; description: string;
}): ShipmentDraftInput | null {
  const parsed = shipmentDraftInputSchema.safeParse({
    provider: shipment.provider,
    recipient: shipment.recipientSnapshot,
    destination: shipment.destinationSnapshot,
    parcels: shipment.parcels,
    payer: shipment.payer,
    declaredValue: Number(shipment.declaredValue),
    codAmount: shipment.codAmount === null ? null : Number(shipment.codAmount),
    description: shipment.description,
  });
  return parsed.success ? parsed.data : null;
}

export function shipmentReadiness(order: {
  status: string;
  items: Array<{ procurementStatus: string }>;
}): { allowed: true } | { allowed: false; reason: 'ORDER_NOT_APPROVED' | 'PROCUREMENT_INCOMPLETE' } {
  if (!['APPROVED', 'AUTO_APPROVED'].includes(order.status)) return { allowed: false, reason: 'ORDER_NOT_APPROVED' };
  return order.items.every((item) => ['IN_STOCK', 'RECEIVED'].includes(item.procurementStatus))
    ? { allowed: true }
    : { allowed: false, reason: 'PROCUREMENT_INCOMPLETE' };
}

function providerShipmentInput(draft: ShipmentDraftInput, sender: Parameters<typeof safeSenderProfile>[0], clientRef: string) {
  const profile = safeSenderProfile(sender);
  if (profile.origin.type === 'ADDRESS' || draft.destination.type === 'ADDRESS') throw new BadRequestException('ADDRESS_DELIVERY_NOT_SUPPORTED');
  return {
    sender: {
      cityRef: profile.origin.cityRef,
      locationRef: profile.origin.locationRef,
      counterpartyRef: profile.senderRef,
      contactRef: profile.contactRef,
      phone: profile.contactPhone,
    },
    recipient: {
      name: draft.recipient.name,
      phone: draft.recipient.phone,
      cityRef: draft.destination.cityRef,
      cityLabel: draft.destination.label,
      locationRef: draft.destination.locationRef,
      locationNumber: draft.destination.label.match(/\d+/)?.[0] ?? '1',
    },
    parcel: draft.parcels[0]!, payer: draft.payer, declaredValue: draft.declaredValue,
    codAmount: draft.codAmount, description: draft.description, clientRef,
  };
}

export function mapShipmentSummary(shipment: {
  id: string; orderId: string; provider: 'NOVA_POSHTA' | 'MEEST' | 'UKRPOSHTA'; status: ShipmentSummary['status'];
  trackingNumber: string | null; cost: unknown; currency: string; createdAt: Date; providerCreatedAt: Date | null;
  acceptedAt: Date | null; deliveredAt: Date | null; cancelledAt: Date | null; lastStatusCheckedAt: Date | null;
  lastErrorCode: string | null; statusEvents: Array<{ status: ShipmentSummary['status'] | null; providerCode: string; occurredAt: Date }>;
}): ShipmentSummary {
  return {
    id: shipment.id, orderId: shipment.orderId, provider: shipment.provider, status: shipment.status,
    trackingNumber: shipment.trackingNumber, cost: shipment.cost === null ? null : Number(shipment.cost), currency: 'UAH',
    createdAt: shipment.createdAt.toISOString(), providerCreatedAt: shipment.providerCreatedAt?.toISOString() ?? null,
    acceptedAt: shipment.acceptedAt?.toISOString() ?? null, deliveredAt: shipment.deliveredAt?.toISOString() ?? null,
    cancelledAt: shipment.cancelledAt?.toISOString() ?? null, lastStatusCheckedAt: shipment.lastStatusCheckedAt?.toISOString() ?? null,
    lastErrorCode: shipment.lastErrorCode,
    history: shipment.statusEvents.map((event) => ({ status: event.status, providerCode: event.providerCode, occurredAt: event.occurredAt.toISOString() })),
  };
}

function safeConnection(connection: {
  provider: 'NOVA_POSHTA' | 'MEEST' | 'UKRPOSHTA';
  status: 'ACTIVE' | 'NEEDS_ATTENTION' | 'DISCONNECTED';
  accountLabel: string | null;
  lastVerifiedAt: Date | null;
  lastErrorCode: string | null;
  senderProfile?: Parameters<typeof safeSenderProfile>[0] | null;
}): DeliveryConnectionSummary {
  return {
    provider: connection.provider,
    status: connection.status,
    accountLabel: connection.accountLabel,
    lastVerifiedAt: connection.lastVerifiedAt?.toISOString() ?? null,
    lastErrorCode: connection.lastErrorCode,
    senderProfile: connection.senderProfile ? safeSenderProfile(connection.senderProfile) : null,
  };
}

function safeSenderProfile(profile: {
  senderRef: string;
  contactRef: string;
  contactPhone: string;
  originType: 'BRANCH' | 'PARCEL_LOCKER' | 'ADDRESS';
  originCityRef: string;
  originLocationRef: string | null;
  originAddressRef: string | null;
  originBuilding: string | null;
  originFlat: string | null;
  originLabel: string | null;
  payer: 'SENDER' | 'RECIPIENT';
  defaultWeightKg: unknown;
  defaultLengthCm: unknown;
  defaultWidthCm: unknown;
  defaultHeightCm: unknown;
  suggestCustomerNotification: boolean;
  customerNotificationTemplate: string;
}): DeliverySenderProfileInput {
  const origin = profile.originType === 'ADDRESS'
    ? {
        type: 'ADDRESS' as const,
        cityRef: profile.originCityRef,
        addressRef: profile.originAddressRef ?? '',
        building: profile.originBuilding ?? '',
        flat: profile.originFlat,
      }
    : {
        type: profile.originType,
        cityRef: profile.originCityRef,
        locationRef: profile.originLocationRef ?? '',
        label: profile.originLabel ?? '',
      };
  return {
    senderRef: profile.senderRef,
    contactRef: profile.contactRef,
    contactPhone: profile.contactPhone,
    origin,
    payer: profile.payer,
    defaultParcel: {
      weightKg: Number(profile.defaultWeightKg),
      lengthCm: Number(profile.defaultLengthCm),
      widthCm: Number(profile.defaultWidthCm),
      heightCm: Number(profile.defaultHeightCm),
    },
    suggestCustomerNotification: profile.suggestCustomerNotification,
    customerNotificationTemplate: profile.customerNotificationTemplate,
  };
}

function senderProfileData(input: DeliverySenderProfileInput) {
  return {
    senderRef: input.senderRef,
    contactRef: input.contactRef,
    contactPhone: input.contactPhone,
    originType: input.origin.type,
    originCityRef: input.origin.cityRef,
    originLocationRef: input.origin.type === 'ADDRESS' ? null : input.origin.locationRef,
    originAddressRef: input.origin.type === 'ADDRESS' ? input.origin.addressRef : null,
    originBuilding: input.origin.type === 'ADDRESS' ? input.origin.building : null,
    originFlat: input.origin.type === 'ADDRESS' ? input.origin.flat : null,
    originLabel: input.origin.type === 'ADDRESS' ? null : input.origin.label,
    payer: input.payer,
    defaultWeightKg: input.defaultParcel.weightKg,
    defaultLengthCm: input.defaultParcel.lengthCm,
    defaultWidthCm: input.defaultParcel.widthCm,
    defaultHeightCm: input.defaultParcel.heightCm,
    suggestCustomerNotification: input.suggestCustomerNotification,
    customerNotificationTemplate: input.customerNotificationTemplate,
  };
}

function validSenderProfile(profile: Parameters<typeof safeSenderProfile>[0] | null): profile is Parameters<typeof safeSenderProfile>[0] {
  return Boolean(profile && deliverySenderProfileInputSchema.safeParse(safeSenderProfile(profile)).success);
}

function isUniqueConstraintError(error: unknown): error is { code: 'P2002' } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
