import { randomUUID } from 'node:crypto';

import { ukrposhtaConnectionInputSchema, type UkrposhtaConnectionInput, type UkrposhtaConnectionSummary } from '@autosale/contracts';
import type { PrismaClient } from '@autosale/database';
import type { CredentialCipher, UkrposhtaClient } from '@autosale/integrations';

type UkrposhtaClientPort = Pick<UkrposhtaClient, 'validateCredential'>;
export type UkrposhtaClientFactory = (input: UkrposhtaConnectionInput) => UkrposhtaClientPort;

type UkrposhtaConnectionServiceOptions = {
  enabled: boolean;
  now?: () => Date;
};

export class UkrposhtaConnectionService {
  private readonly now: () => Date;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly cipher: CredentialCipher,
    private readonly clientFactory: UkrposhtaClientFactory,
    private readonly options: UkrposhtaConnectionServiceOptions,
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async summary(tenantId: string): Promise<{ enabled: boolean; connection: UkrposhtaConnectionSummary | null }> {
    if (!this.options.enabled) return { enabled: false, connection: null };
    const connection = await this.prisma.deliveryConnection.findUnique({
      where: { tenantId_provider: { tenantId, provider: 'UKRPOSHTA' } },
    });
    return { enabled: true, connection: connection ? safeConnection(connection, this.cipher) : null };
  }

  async connect(tenantId: string, userId: string, input: UkrposhtaConnectionInput): Promise<UkrposhtaConnectionSummary> {
    this.assertEnabled();
    const client = this.clientFactory(input);
    const identity = await client.validateCredential();
    const encryptedCredential = this.cipher.encrypt(JSON.stringify(input));
    const credentialGenerationId = randomUUID();
    const verifiedAt = this.now();
    const connection = await this.prisma.deliveryConnection.upsert({
      where: { tenantId_provider: { tenantId, provider: 'UKRPOSHTA' } },
      create: {
        tenantId, provider: 'UKRPOSHTA', status: 'ACTIVE', encryptedCredential, credentialGenerationId,
        accountLabel: identity.accountLabel, connectedByUserId: userId, lastVerifiedAt: verifiedAt,
      },
      update: {
        status: 'ACTIVE', encryptedCredential, credentialGenerationId, accountLabel: identity.accountLabel,
        connectedByUserId: userId, lastVerifiedAt: verifiedAt, lastErrorCode: null, disconnectedAt: null,
      },
    });
    return safeConnection(connection, this.cipher, input.environment);
  }

  async disconnect(tenantId: string): Promise<UkrposhtaConnectionSummary> {
    this.assertEnabled();
    const result = await this.prisma.deliveryConnection.updateMany({
      where: { tenantId, provider: 'UKRPOSHTA' },
      data: {
        status: 'DISCONNECTED', disconnectedAt: this.now(), encryptedCredential: this.cipher.encrypt(randomUUID()),
        credentialGenerationId: randomUUID(), lastErrorCode: null,
      },
    });
    if (result.count !== 1) throw new Error('Ukrposhta connection not found');
    return {
      provider: 'UKRPOSHTA', status: 'DISCONNECTED', accountLabel: null, lastVerifiedAt: null,
      lastErrorCode: null, environment: null,
    };
  }

  async clientContextForTenant(tenantId: string): Promise<{ client: UkrposhtaClientPort; credentialGenerationId: string }> {
    this.assertEnabled();
    const connection = await this.prisma.deliveryConnection.findUnique({
      where: { tenantId_provider: { tenantId, provider: 'UKRPOSHTA' } },
      select: { status: true, encryptedCredential: true, credentialGenerationId: true },
    });
    if (!connection || connection.status !== 'ACTIVE') throw new Error('Active Ukrposhta connection required');
    const credentials = parseStoredCredentials(this.cipher.decrypt(connection.encryptedCredential));
    return { client: this.clientFactory(credentials), credentialGenerationId: connection.credentialGenerationId };
  }

  private assertEnabled(): void {
    if (!this.options.enabled) throw new Error('Ukrposhta delivery is disabled');
  }
}

function parseStoredCredentials(value: string): UkrposhtaConnectionInput {
  try {
    return ukrposhtaConnectionInputSchema.parse(JSON.parse(value));
  } catch {
    throw new Error('Stored Ukrposhta credentials are invalid');
  }
}

function safeConnection(connection: {
  provider: 'NOVA_POSHTA' | 'MEEST' | 'UKRPOSHTA';
  status: 'ACTIVE' | 'NEEDS_ATTENTION' | 'DISCONNECTED';
  accountLabel: string | null;
  lastVerifiedAt: Date | null;
  lastErrorCode: string | null;
  encryptedCredential: string;
}, cipher: CredentialCipher, knownEnvironment?: UkrposhtaConnectionInput['environment']): UkrposhtaConnectionSummary {
  return {
    provider: 'UKRPOSHTA',
    status: connection.status,
    accountLabel: connection.accountLabel,
    lastVerifiedAt: connection.lastVerifiedAt?.toISOString() ?? null,
    lastErrorCode: connection.lastErrorCode,
    environment: knownEnvironment ?? storedEnvironment(connection.encryptedCredential, cipher),
  };
}

function storedEnvironment(encryptedCredential: string, cipher: CredentialCipher): UkrposhtaConnectionInput['environment'] | null {
  try {
    return parseStoredCredentials(cipher.decrypt(encryptedCredential)).environment;
  } catch {
    return null;
  }
}
