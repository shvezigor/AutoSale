import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@autosale/database';
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
    const cleanups = await this.prisma.instagramAvatarCleanup.updateManyAndReturn({
      where: {
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
      limit: 100,
    });
    let deleted = 0;
    let failed = 0;
    let referenced = 0;

    for (const cleanup of cleanups) {
      const currentReference = await this.prisma.instagramCustomerProfile.findFirst({
        where: { avatarStorageKey: cleanup.storageKey },
        select: { id: true },
      });
      if (currentReference) {
        referenced += 1;
        await this.complete(cleanup.id, leaseId);
        continue;
      }
      try {
        await this.storage.delete(cleanup.storageKey);
        deleted += 1;
        await this.complete(cleanup.id, leaseId);
      } catch (error) {
        failed += 1;
        await this.prisma.instagramAvatarCleanup.updateMany({
          where: { id: cleanup.id, status: 'PROCESSING', leaseId },
          data: {
            status: 'RETRYABLE_FAILURE',
            nextAttemptAt: new Date(now.getTime() + RETRY_DELAY_MS),
            leaseId: null,
            leaseExpiresAt: null,
            lastErrorCode: error instanceof Error ? error.name.slice(0, 100) : 'UNKNOWN',
          },
        });
      }
    }

    return { attempted: cleanups.length, deleted, failed, referenced };
  }

  private async complete(id: string, leaseId: string): Promise<void> {
    await this.prisma.instagramAvatarCleanup.updateMany({
      where: { id, status: 'PROCESSING', leaseId },
      data: {
        status: 'SUCCEEDED',
        leaseId: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
      },
    });
  }
}
