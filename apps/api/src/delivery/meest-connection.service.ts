import { randomUUID } from 'node:crypto';

import type { DeliveryConnectionSummary, MeestConnectionInput } from '@autosale/contracts';
import type { PrismaClient } from '@autosale/database';
import type { CredentialCipher, MeestClient } from '@autosale/integrations';

type MeestClientPort = Pick<MeestClient, 'validateCredential'>;
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

  async summary(tenantId: string): Promise<{ enabled: boolean; connection: DeliveryConnectionSummary | null }> {
    if (!this.options.enabled) return { enabled: false, connection: null };
    const connection = await this.prisma.deliveryConnection.findUnique({
      where: { tenantId_provider: { tenantId, provider: 'MEEST' } },
      include: { senderProfile: true },
    });
    return { enabled: true, connection: connection ? safeConnection(connection) : null };
  }

  async connect(tenantId: string, userId: string, input: MeestConnectionInput): Promise<DeliveryConnectionSummary> {
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

  async disconnect(tenantId: string): Promise<DeliveryConnectionSummary> {
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

  private assertEnabled(): void {
    if (!this.options.enabled) throw new Error('Meest delivery is disabled');
  }
}

function safeConnection(connection: {
  provider: 'NOVA_POSHTA' | 'MEEST' | 'UKRPOSHTA';
  status: 'ACTIVE' | 'NEEDS_ATTENTION' | 'DISCONNECTED';
  accountLabel: string | null;
  lastVerifiedAt: Date | null;
  lastErrorCode: string | null;
}): DeliveryConnectionSummary {
  return {
    provider: connection.provider,
    status: connection.status,
    accountLabel: connection.accountLabel,
    lastVerifiedAt: connection.lastVerifiedAt?.toISOString() ?? null,
    lastErrorCode: connection.lastErrorCode,
    senderProfile: null,
  };
}
