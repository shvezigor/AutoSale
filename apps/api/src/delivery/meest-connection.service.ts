import { randomUUID } from 'node:crypto';

import { meestConnectionInputSchema, type MeestConnectionInput, type MeestConnectionSummary, type MeestSenderProfileInput } from '@autosale/contracts';
import type { PrismaClient } from '@autosale/database';
import type { CredentialCipher, MeestClient } from '@autosale/integrations';

type MeestClientPort = Pick<MeestClient, 'validateCredential' | 'searchCities' | 'searchLocations'>;
export type MeestClientFactory = (input: MeestConnectionInput) => MeestClientPort;

type MeestConnectionServiceOptions = {
  enabled: boolean;
  now?: () => Date;
};

export class MeestConnectionService {
  private readonly now: () => Date;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly cipher: CredentialCipher,
    private readonly clientFactory: MeestClientFactory,
    private readonly options: MeestConnectionServiceOptions,
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async summary(tenantId: string): Promise<{ enabled: boolean; connection: MeestConnectionSummary | null }> {
    if (!this.options.enabled) return { enabled: false, connection: null };
    const connection = await this.prisma.deliveryConnection.findUnique({
      where: { tenantId_provider: { tenantId, provider: 'MEEST' } },
      include: { senderProfile: true },
    });
    return { enabled: true, connection: connection ? safeConnection(connection) : null };
  }

  async connect(tenantId: string, userId: string, input: MeestConnectionInput): Promise<MeestConnectionSummary> {
    this.assertEnabled();
    const client = this.clientFactory(input);
    const identity = await client.validateCredential();
    const encryptedCredential = this.cipher.encrypt(JSON.stringify(input));
    const credentialGenerationId = randomUUID();
    const verifiedAt = this.now();
    const connection = await this.prisma.deliveryConnection.upsert({
      where: { tenantId_provider: { tenantId, provider: 'MEEST' } },
      create: {
        tenantId, provider: 'MEEST', status: 'ACTIVE', encryptedCredential, credentialGenerationId,
        accountLabel: identity.accountLabel, connectedByUserId: userId, lastVerifiedAt: verifiedAt,
      },
      update: {
        status: 'ACTIVE', encryptedCredential, credentialGenerationId, accountLabel: identity.accountLabel,
        connectedByUserId: userId, lastVerifiedAt: verifiedAt, lastErrorCode: null, disconnectedAt: null,
      },
      include: { senderProfile: true },
    });
    return safeConnection(connection);
  }

  async disconnect(tenantId: string): Promise<MeestConnectionSummary> {
    this.assertEnabled();
    const result = await this.prisma.deliveryConnection.updateMany({
      where: { tenantId, provider: 'MEEST' },
      data: {
        status: 'DISCONNECTED', disconnectedAt: this.now(), encryptedCredential: this.cipher.encrypt(randomUUID()),
        credentialGenerationId: randomUUID(), lastErrorCode: null,
      },
    });
    if (result.count !== 1) throw new Error('Meest connection not found');
    return {
      provider: 'MEEST', status: 'DISCONNECTED', accountLabel: null, lastVerifiedAt: null,
      lastErrorCode: null, senderProfile: null,
    };
  }

  async clientContextForTenant(tenantId: string): Promise<{ client: MeestClientPort; credentialGenerationId: string }> {
    this.assertEnabled();
    const connection = await this.prisma.deliveryConnection.findUnique({
      where: { tenantId_provider: { tenantId, provider: 'MEEST' } },
      select: { status: true, encryptedCredential: true, credentialGenerationId: true },
    });
    if (!connection || connection.status !== 'ACTIVE') throw new Error('Active Meest connection required');
    const credentials = parseStoredCredentials(this.cipher.decrypt(connection.encryptedCredential));
    return {
      client: this.clientFactory(credentials),
      credentialGenerationId: connection.credentialGenerationId,
    };
  }

  async saveSenderProfile(tenantId: string, input: MeestSenderProfileInput): Promise<MeestSenderProfileInput> {
    this.assertEnabled();
    const connection = await this.prisma.deliveryConnection.findUnique({
      where: { tenantId_provider: { tenantId, provider: 'MEEST' } },
      select: { id: true, status: true },
    });
    if (!connection || connection.status !== 'ACTIVE') throw new Error('Active Meest connection required');
    const data = meestSenderProfileData(input);
    await this.prisma.deliverySenderProfile.upsert({
      where: { tenantId_connectionId: { tenantId, connectionId: connection.id } },
      create: { tenantId, connectionId: connection.id, ...data },
      update: data,
    });
    return input;
  }

  private assertEnabled(): void {
    if (!this.options.enabled) throw new Error('Meest delivery is disabled');
  }
}

function parseStoredCredentials(value: string): MeestConnectionInput {
  try {
    return meestConnectionInputSchema.parse(JSON.parse(value));
  } catch {
    throw new Error('Stored Meest credentials are invalid');
  }
}

function safeConnection(connection: {
  provider: 'NOVA_POSHTA' | 'MEEST' | 'UKRPOSHTA';
  status: 'ACTIVE' | 'NEEDS_ATTENTION' | 'DISCONNECTED';
  accountLabel: string | null;
  lastVerifiedAt: Date | null;
  lastErrorCode: string | null;
  senderProfile?: StoredSenderProfile | null;
}): MeestConnectionSummary {
  return {
    provider: 'MEEST',
    status: connection.status,
    accountLabel: connection.accountLabel,
    lastVerifiedAt: connection.lastVerifiedAt?.toISOString() ?? null,
    lastErrorCode: connection.lastErrorCode,
    senderProfile: connection.senderProfile ? safeMeestSenderProfile(connection.senderProfile) : null,
  };
}

type StoredSenderProfile = {
  senderRef: string; contactPhone: string; originType: 'BRANCH' | 'PARCEL_LOCKER' | 'ADDRESS';
  originCityRef: string; originLocationRef: string | null; originLabel: string | null;
  payer: 'SENDER' | 'RECIPIENT'; defaultWeightKg: unknown; defaultLengthCm: unknown;
  defaultWidthCm: unknown; defaultHeightCm: unknown; suggestCustomerNotification: boolean;
  customerNotificationTemplate: string;
};

function safeMeestSenderProfile(profile: StoredSenderProfile): MeestSenderProfileInput {
  if (profile.originType === 'ADDRESS' || !profile.originLocationRef || !profile.originLabel) {
    throw new Error('Stored Meest sender profile is invalid');
  }
  return {
    senderName: profile.senderRef,
    senderPhone: profile.contactPhone,
    origin: { type: profile.originType, cityRef: profile.originCityRef, locationRef: profile.originLocationRef, label: profile.originLabel },
    payer: profile.payer,
    defaultParcel: {
      weightKg: Number(profile.defaultWeightKg), lengthCm: Number(profile.defaultLengthCm),
      widthCm: Number(profile.defaultWidthCm), heightCm: Number(profile.defaultHeightCm),
    },
    suggestCustomerNotification: profile.suggestCustomerNotification,
    customerNotificationTemplate: profile.customerNotificationTemplate,
  };
}

function meestSenderProfileData(input: MeestSenderProfileInput) {
  return {
    senderRef: input.senderName,
    contactRef: 'MEEST_SENDER',
    contactPhone: input.senderPhone,
    originType: input.origin.type,
    originCityRef: input.origin.cityRef,
    originLocationRef: input.origin.locationRef,
    originAddressRef: null,
    originBuilding: null,
    originFlat: null,
    originLabel: input.origin.label,
    payer: input.payer,
    defaultWeightKg: input.defaultParcel.weightKg,
    defaultLengthCm: input.defaultParcel.lengthCm,
    defaultWidthCm: input.defaultParcel.widthCm,
    defaultHeightCm: input.defaultParcel.heightCm,
    suggestCustomerNotification: input.suggestCustomerNotification,
    customerNotificationTemplate: input.customerNotificationTemplate,
  };
}
