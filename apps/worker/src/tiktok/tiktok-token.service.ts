import { randomUUID } from 'node:crypto';

import { type PrismaClient, withTenantTransaction } from '@autosale/database';
import {
  type CredentialCipher,
  type TikTokBusinessMessagingClient,
  TikTokBusinessMessagingError,
} from '@autosale/integrations';

const REFRESH_AHEAD_MS = 5 * 60_000;
const REFRESH_LEASE_MS = 30_000;
const MAX_WAIT_ATTEMPTS = 100;

export class TikTokTokenService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly client: Pick<TikTokBusinessMessagingClient, 'refreshToken'>,
    private readonly cipher: CredentialCipher,
    private readonly wait: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 100)),
  ) {}

  async getFreshAccessToken(tenantId: string, credentialGenerationId: string, now = new Date()): Promise<string> {
    for (let attempt = 0; attempt < MAX_WAIT_ATTEMPTS; attempt += 1) {
      const connection = await this.readConnection(tenantId, credentialGenerationId);
      if (!connection) throw unavailable();
      if (connection.tokenExpiresAt && connection.tokenExpiresAt.getTime() > now.getTime() + REFRESH_AHEAD_MS) {
        return this.decrypt(connection.encryptedAccessToken);
      }
      if (!connection.encryptedRefreshToken || (
        connection.refreshTokenExpiresAt && connection.refreshTokenExpiresAt <= now
      )) {
        await this.markReauthorization(tenantId, credentialGenerationId, 'TIKTOK_REFRESH_TOKEN_EXPIRED');
        throw unavailable();
      }

      const leaseId = randomUUID();
      const claimed = await withTenantTransaction(this.prisma, tenantId, (transaction) =>
        transaction.tikTokConnection.updateMany({
          where: {
            tenantId,
            credentialGenerationId,
            status: { in: ['ACTIVE', 'INBOUND_ONLY'] },
            OR: [
              { refreshLeaseId: null, refreshLeaseExpiresAt: null },
              { refreshLeaseExpiresAt: { lte: now } },
            ],
          },
          data: { refreshLeaseId: leaseId, refreshLeaseExpiresAt: new Date(now.getTime() + REFRESH_LEASE_MS) },
        }));
      if (claimed.count === 1) {
        return this.refreshClaimed(tenantId, credentialGenerationId, leaseId, connection.externalAccountId, connection.encryptedRefreshToken, now);
      }
      await this.wait();
    }
    throw new Error('TikTok token refresh timed out');
  }

  private async refreshClaimed(
    tenantId: string,
    credentialGenerationId: string,
    leaseId: string,
    expectedAccountId: string,
    encryptedRefreshToken: string,
    now: Date,
  ): Promise<string> {
    try {
      const refreshed = await this.client.refreshToken(this.decrypt(encryptedRefreshToken));
      if (refreshed.accountId !== expectedAccountId) throw new Error('TikTok token identity changed');
      const updated = await withTenantTransaction(this.prisma, tenantId, (transaction) =>
        transaction.tikTokConnection.updateMany({
          where: { tenantId, credentialGenerationId, refreshLeaseId: leaseId },
          data: {
            encryptedAccessToken: this.cipher.encrypt(refreshed.accessToken),
            encryptedRefreshToken: this.cipher.encrypt(refreshed.refreshToken),
            tokenExpiresAt: new Date(now.getTime() + refreshed.expiresIn * 1_000),
            refreshTokenExpiresAt: new Date(now.getTime() + refreshed.refreshTokenExpiresIn * 1_000),
            grantedScopes: [...new Set(refreshed.grantedScopes)].sort().join(','),
            refreshLeaseId: null,
            refreshLeaseExpiresAt: null,
            lastVerifiedAt: now,
            lastErrorCode: null,
          },
        }));
      if (updated.count !== 1) throw unavailable();
      return refreshed.accessToken;
    } catch (error) {
      const permanent = error instanceof TikTokBusinessMessagingError && !error.retryable;
      await withTenantTransaction(this.prisma, tenantId, (transaction) =>
        transaction.tikTokConnection.updateMany({
          where: { tenantId, credentialGenerationId, refreshLeaseId: leaseId },
          data: {
            ...(permanent ? { status: 'REAUTH_REQUIRED' as const } : {}),
            lastErrorCode: permanent ? 'TIKTOK_TOKEN_REFRESH_REJECTED' : 'TIKTOK_TOKEN_REFRESH_RETRYABLE',
            refreshLeaseId: null,
            refreshLeaseExpiresAt: null,
          },
        })).catch(() => undefined);
      if (permanent) throw new Error('TikTok token refresh failed');
      throw error;
    }
  }

  private readConnection(tenantId: string, credentialGenerationId: string) {
    return withTenantTransaction(this.prisma, tenantId, (transaction) =>
      transaction.tikTokConnection.findFirst({
        where: { tenantId, credentialGenerationId, status: { in: ['ACTIVE', 'INBOUND_ONLY'] } },
        select: {
          externalAccountId: true,
          encryptedAccessToken: true,
          encryptedRefreshToken: true,
          tokenExpiresAt: true,
          refreshTokenExpiresAt: true,
        },
      }));
  }

  private async markReauthorization(tenantId: string, credentialGenerationId: string, code: string): Promise<void> {
    await withTenantTransaction(this.prisma, tenantId, (transaction) => transaction.tikTokConnection.updateMany({
      where: { tenantId, credentialGenerationId },
      data: { status: 'REAUTH_REQUIRED', lastErrorCode: code, refreshLeaseId: null, refreshLeaseExpiresAt: null },
    }));
  }

  private decrypt(value: string | null): string {
    if (!value) throw unavailable();
    try {
      return this.cipher.decrypt(value);
    } catch {
      throw unavailable();
    }
  }
}

function unavailable(): Error {
  return new Error('TikTok credentials unavailable');
}
