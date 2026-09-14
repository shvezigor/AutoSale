import type { PrismaClient } from '@autosale/database';
import type { ObjectStorage } from '@autosale/integrations';

const LEASE_MS = 60_000;
const REFERENCED_RETRY_MS = 60 * 60_000;
const MAX_ATTEMPTS = 8;
const MAX_RETRY_MS = 6 * 60 * 60_000;

export class UserAvatarCleanupReconciler {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: Pick<ObjectStorage, 'delete'>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async runOnce(limit = 100): Promise<{ deleted: number; retried: number; deadLettered: number }> {
    const now = this.now();
    const candidates = await this.prisma.userAvatarCleanup.findMany({
      where: claimable(now),
      orderBy: { nextAttemptAt: 'asc' },
      take: limit,
    });
    let deleted = 0;
    let retried = 0;
    let deadLettered = 0;

    for (const candidate of candidates) {
      const leaseUntil = new Date(now.getTime() + LEASE_MS);
      const claimed = await this.prisma.userAvatarCleanup.updateMany({
        where: { id: candidate.id, ...claimable(now) },
        data: { status: 'PROCESSING', leaseUntil },
      });
      if (claimed.count !== 1) continue;

      const references = await this.prisma.user.count({
        where: { avatarStorageKey: candidate.storageKey },
      });
      if (references > 0) {
        retried += 1;
        await this.prisma.userAvatarCleanup.updateMany({
          where: { id: candidate.id, status: 'PROCESSING', leaseUntil },
          data: {
            status: 'PENDING',
            nextAttemptAt: new Date(now.getTime() + REFERENCED_RETRY_MS),
            leaseUntil: null,
            lastErrorCode: null,
          },
        });
        continue;
      }

      try {
        await this.storage.delete(candidate.storageKey);
        deleted += 1;
        await this.prisma.userAvatarCleanup.updateMany({
          where: { id: candidate.id, status: 'PROCESSING', leaseUntil },
          data: { status: 'COMPLETED', leaseUntil: null, lastErrorCode: null },
        });
      } catch (error) {
        const attempts = candidate.attempts + 1;
        const deadLetter = attempts >= MAX_ATTEMPTS;
        if (deadLetter) deadLettered += 1;
        else retried += 1;
        await this.prisma.userAvatarCleanup.updateMany({
          where: { id: candidate.id, status: 'PROCESSING', leaseUntil },
          data: {
            status: deadLetter ? 'DEAD_LETTER' : 'PENDING',
            attempts,
            nextAttemptAt: deadLetter ? candidate.nextAttemptAt : new Date(now.getTime() + retryDelay(attempts)),
            leaseUntil: null,
            lastErrorCode: normalizeErrorCode(error),
          },
        });
      }
    }

    return { deleted, retried, deadLettered };
  }
}

function claimable(now: Date) {
  return {
    OR: [
      { status: 'PENDING', nextAttemptAt: { lte: now } },
      { status: 'PROCESSING', leaseUntil: { lte: now } },
    ],
  };
}

function retryDelay(attempts: number): number {
  return Math.min((2 ** attempts) * 60_000, MAX_RETRY_MS);
}

function normalizeErrorCode(error: unknown): string {
  return (error instanceof Error ? error.name : 'UNKNOWN').slice(0, 100);
}
