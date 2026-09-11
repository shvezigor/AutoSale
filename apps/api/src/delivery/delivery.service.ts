import { randomUUID } from 'node:crypto';

import type { DeliveryConnectionInput, DeliveryConnectionSummary, DeliverySenderProfileInput } from '@autosale/contracts';
import type { PrismaClient } from '@autosale/database';
import type { CredentialCipher, NovaPoshtaClient, NovaPoshtaSenderProfile } from '@autosale/integrations';

type NovaPoshtaClientPort = Pick<NovaPoshtaClient, 'validateCredential' | 'listSenderProfiles'>;
export type NovaPoshtaClientFactory = (apiKey: string) => NovaPoshtaClientPort;

type DeliveryServiceOptions = {
  enabled: boolean;
  now?: () => Date;
};

export class DeliveryService {
  private readonly now: () => Date;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly cipher: CredentialCipher,
    private readonly novaPoshtaClient: NovaPoshtaClientFactory,
    private readonly options: DeliveryServiceOptions,
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
    this.assertEnabled();
    const connection = await this.prisma.deliveryConnection.findUnique({
      where: { tenantId_provider: { tenantId, provider: 'NOVA_POSHTA' } },
      select: { status: true, encryptedCredential: true },
    });
    if (!connection || connection.status !== 'ACTIVE') throw new Error('Active Nova Poshta connection required');
    return this.novaPoshtaClient(this.cipher.decrypt(connection.encryptedCredential));
  }

  private assertEnabled(): void {
    if (!this.options.enabled) throw new Error('Nova Poshta delivery is disabled');
  }
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
