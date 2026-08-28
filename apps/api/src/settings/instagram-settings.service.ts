import type { PrismaClient } from '@autosale/database';

export class InstagramSettingsService {
  constructor(private readonly prisma: PrismaClient) {}
  async get(tenantId: string) {
    const value = await this.prisma.instagramConnection.findUnique({
      where: { tenantId },
      select: {
        externalAccountId: true,
        displayName: true,
        status: true,
        tokenExpiresAt: true,
        lastVerifiedAt: true,
        lastErrorCode: true,
      },
    });
    return value
      ? {
          status: value.status,
          accountId: value.externalAccountId,
          username: value.displayName,
          tokenExpiresAt: value.tokenExpiresAt?.toISOString() ?? null,
          lastVerifiedAt: value.lastVerifiedAt?.toISOString() ?? null,
          lastErrorCode: value.lastErrorCode,
        }
      : {
          status: 'NOT_CONNECTED' as const,
          accountId: null,
          username: null,
          tokenExpiresAt: null,
          lastVerifiedAt: null,
          lastErrorCode: null,
        };
  }
}
