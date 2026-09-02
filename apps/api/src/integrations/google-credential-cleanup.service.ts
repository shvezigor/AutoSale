import type { PrismaClient } from '@autosale/database';

import { CredentialCipher } from './credential-cipher.js';
import type { GoogleOAuthClientPort } from './google-oauth.client.js';

type GoogleCredentialCleanupRow = NonNullable<Awaited<ReturnType<PrismaClient['googleCredentialCleanup']['findFirst']>>>;

export class GoogleCredentialCleanupService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly client: Pick<GoogleOAuthClientPort, 'revokeRefreshToken'>,
    private readonly cipher: CredentialCipher,
  ) {}

  async disconnect(tenantId: string, _actorUserId: string): Promise<{ status: 'DISCONNECTED' | 'DISCONNECTING' }> {
    const cleanup = await this.prisma.$transaction(async (transaction) => {
      const connection = await transaction.googleConnection.findUnique({
        where: { tenantId },
        select: { credentialGenerationId: true, encryptedRefreshToken: true },
      });
      if (!connection?.credentialGenerationId || !connection.encryptedRefreshToken) return null;
      await transaction.googleConnection.update({ where: { tenantId }, data: { status: 'DISCONNECTING' } });
      await transaction.catalogueSource.updateMany({ where: { tenantId, type: 'GOOGLE_SHEETS' }, data: { status: 'PAUSED', lastErrorSummary: 'Google connection disconnected' } });
      await transaction.googleSheetsDestination.updateMany({ where: { tenantId }, data: { status: 'ERROR', errorSummary: 'Google connection disconnected' } });
      return transaction.googleCredentialCleanup.upsert({
        where: { credentialGenerationId: connection.credentialGenerationId },
        create: {
          tenantId,
          credentialGenerationId: connection.credentialGenerationId,
          encryptedRefreshToken: connection.encryptedRefreshToken,
          status: 'PENDING',
        },
        update: { status: 'PENDING', lastErrorCode: null, terminalAt: null },
      });
    });
    if (!cleanup) return { status: 'DISCONNECTED' };

    return await this.processCleanup(cleanup)
      ? { status: 'DISCONNECTED' }
      : { status: 'DISCONNECTING' };
  }

  async reconcilePending(limit = 25): Promise<{ attempted: number; completed: number }> {
    const boundedLimit = Math.max(1, Math.min(limit, 100));
    const cleanups = await this.prisma.googleCredentialCleanup.findMany({
      where: {
        terminalAt: null,
        status: { in: ['PENDING', 'FAILED'] },
      },
      orderBy: { updatedAt: 'asc' },
      take: boundedLimit,
    });
    let completed = 0;
    for (const cleanup of cleanups) {
      if (await this.processCleanup(cleanup)) completed += 1;
    }
    return { attempted: cleanups.length, completed };
  }

  private async processCleanup(cleanup: GoogleCredentialCleanupRow): Promise<boolean> {
    try {
      await this.client.revokeRefreshToken(this.cipher.decrypt(cleanup.encryptedRefreshToken));
      const now = new Date();
      await this.prisma.$transaction(async (transaction) => {
        await transaction.googleCredentialCleanup.update({
          where: { id: cleanup.id },
          data: { status: 'SUCCEEDED', attempts: { increment: 1 }, terminalAt: now, lastErrorCode: null },
        });
        await transaction.googleConnection.updateMany({
          where: { tenantId: cleanup.tenantId, credentialGenerationId: cleanup.credentialGenerationId },
          data: { status: 'DISCONNECTED', encryptedRefreshToken: null, credentialGenerationId: null, disconnectedAt: now },
        });
      });
      return true;
    } catch {
      await this.prisma.googleCredentialCleanup.update({
        where: { id: cleanup.id },
        data: { status: 'FAILED', attempts: { increment: 1 }, lastErrorCode: 'GOOGLE_REVOCATION_FAILED' },
      });
      return false;
    }
  }
}
