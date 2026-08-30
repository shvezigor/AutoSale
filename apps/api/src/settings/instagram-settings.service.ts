import type { PrismaClient } from '@autosale/database';

import { INSTAGRAM_CLEANUP_ABANDON_AFTER_ATTEMPTS } from '../integrations/instagram-oauth.service.js';

export class InstagramSettingsService {
  constructor(private readonly prisma: PrismaClient) {}
  async get(tenantId: string) {
    const [value, cleanupRows] = await Promise.all([
      this.prisma.instagramConnection.findUnique({
        where: { tenantId },
        select: {
          externalAccountId: true,
          displayName: true,
          status: true,
          tokenExpiresAt: true,
          lastVerifiedAt: true,
          lastErrorCode: true,
        },
      }),
      this.prisma.instagramCredentialCleanup.findMany({
        where: { tenantId, terminalAt: null },
        select: {
          unsubscribeStatus: true,
          revokeStatus: true,
          attempts: true,
          leaseId: true,
          leaseExpiresAt: true,
          lastErrorCode: true,
        },
      }),
    ]);
    const cleanup = summarizeCleanup(cleanupRows);
    return value
      ? {
          status: value.status,
          accountId: value.externalAccountId,
          username: value.displayName,
          tokenExpiresAt: value.tokenExpiresAt?.toISOString() ?? null,
          lastVerifiedAt: value.lastVerifiedAt?.toISOString() ?? null,
          lastErrorCode: value.lastErrorCode,
          cleanupStatus: cleanup.status,
          cleanupErrorCode: cleanup.errorCode,
          cleanupAbandonEligible: cleanup.abandonEligible,
        }
      : {
          status: 'NOT_CONNECTED' as const,
          accountId: null,
          username: null,
          tokenExpiresAt: null,
          lastVerifiedAt: null,
          lastErrorCode: null,
          cleanupStatus: cleanup.status,
          cleanupErrorCode: cleanup.errorCode,
          cleanupAbandonEligible: cleanup.abandonEligible,
        };
  }
}

type CleanupRow = {
  unsubscribeStatus: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  revokeStatus: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  attempts: number;
  leaseId: string | null;
  leaseExpiresAt: Date | null;
  lastErrorCode: string | null;
};

function summarizeCleanup(rows: CleanupRow[]): {
  status: 'NONE' | 'PENDING' | 'FAILED';
  errorCode: string | null;
  abandonEligible: boolean;
} {
  if (rows.length === 0) return { status: 'NONE', errorCode: null, abandonEligible: false };
  const failed = rows.find((row) =>
    row.lastErrorCode !== null ||
    row.unsubscribeStatus === 'FAILED' ||
    row.revokeStatus === 'FAILED');
  const abandonEligible = rows.some((row) => {
    const firstIncomplete = row.unsubscribeStatus !== 'SUCCEEDED' ? row.unsubscribeStatus : row.revokeStatus;
    const failedOperation = firstIncomplete === 'FAILED';
    return failedOperation &&
      row.attempts >= INSTAGRAM_CLEANUP_ABANDON_AFTER_ATTEMPTS &&
      row.leaseId === null &&
      row.leaseExpiresAt === null;
  });
  if (failed) return { status: 'FAILED', errorCode: failed.lastErrorCode ?? 'META_DISCONNECT_CLEANUP_FAILED', abandonEligible };
  return { status: 'PENDING', errorCode: null, abandonEligible };
}
