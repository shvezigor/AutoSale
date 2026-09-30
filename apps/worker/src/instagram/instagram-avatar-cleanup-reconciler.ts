import { randomUUID } from 'node:crypto';

import { type PrismaClient, withTenantTransaction } from '@autosale/database';
import type { ObjectStorage } from '@autosale/integrations';

const LEASE_MS = 5 * 60_000;
const RETRY_DELAY_MS = 5 * 60_000;

export class InstagramAvatarCleanupReconciler {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: Pick<ObjectStorage, 'delete'>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async reconcile(): Promise<{ attempted: number; deleted: number; failed: number; referenced: number }> {
    const now = this.now();
    const leaseId = randomUUID();
    const candidates = await this.prisma.$queryRaw<Array<{ tenant_id: string; cleanup_id: string }>>`
      SELECT tenant_id, cleanup_id
      FROM public.worker_due_instagram_avatar_cleanups(${now}, 100)
    `;
    let deleted = 0;
    let failed = 0;
    let referenced = 0;
    let attempted = 0;

    for (const candidate of candidates) {
      const cleanups = await withTenantTransaction(this.prisma, candidate.tenant_id, (transaction) =>
        transaction.instagramAvatarCleanup.updateManyAndReturn({
          where: {
            id: candidate.cleanup_id,
            OR: [
              { status: { in: ['PENDING', 'RETRYABLE_FAILURE'] }, nextAttemptAt: { lte: now } },
              { status: 'PROCESSING', leaseExpiresAt: { lte: now } },
            ],
          },
          data: {
            status: 'PROCESSING',
            leaseId,
            leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
            attempts: { increment: 1 },
          },
          limit: 1,
        }));
      const cleanup = cleanups[0];
      if (!cleanup) continue;
      attempted += 1;
      const currentReference = await withTenantTransaction(this.prisma, cleanup.tenantId, (transaction) => transaction.instagramCustomerProfile.findFirst({
        where: { avatarStorageKey: cleanup.storageKey },
        select: { id: true },
      }));
      if (currentReference) {
        referenced += 1;
        await this.complete(cleanup.tenantId, cleanup.id, leaseId);
        continue;
      }
      try {
        await this.storage.delete(cleanup.storageKey);
        deleted += 1;
        await this.complete(cleanup.tenantId, cleanup.id, leaseId);
      } catch (error) {
        failed += 1;
        await withTenantTransaction(this.prisma, cleanup.tenantId, (transaction) => transaction.instagramAvatarCleanup.updateMany({
          where: { id: cleanup.id, status: 'PROCESSING', leaseId },
          data: {
            status: 'RETRYABLE_FAILURE',
            nextAttemptAt: new Date(now.getTime() + RETRY_DELAY_MS),
            leaseId: null,
            leaseExpiresAt: null,
            lastErrorCode: error instanceof Error ? error.name.slice(0, 100) : 'UNKNOWN',
          },
        }));
      }
    }

    return { attempted, deleted, failed, referenced };
  }

  private async complete(tenantId: string, id: string, leaseId: string): Promise<void> {
    await withTenantTransaction(this.prisma, tenantId, (transaction) => transaction.instagramAvatarCleanup.updateMany({
      where: { id, status: 'PROCESSING', leaseId },
      data: {
        status: 'SUCCEEDED',
        leaseId: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
      },
    }));
  }
}
