import type { PrismaClient } from '@autosale/database';

import type { InstagramProfileEnrichmentJob } from './instagram-profile-enrichment.service.js';

interface ProfileQueue {
  add(
    name: 'instagram.profile.enrich',
    data: InstagramProfileEnrichmentJob,
    options: { jobId: string; removeOnFail: true },
  ): Promise<unknown>;
}

export class InstagramProfileReconciler {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly queue: ProfileQueue,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async reconcile(): Promise<{ attempted: number; failed: number }> {
    const now = this.now();
    await this.prisma.instagramCustomerProfile.updateMany({
      where: {
        status: { in: ['READY', 'UNAVAILABLE'] },
        refreshAfter: { lte: now },
      },
      data: {
        status: 'PENDING',
        nextAttemptAt: now,
        refreshVersion: { increment: 1 },
      },
    });

    const due = await this.prisma.instagramCustomerProfile.findMany({
      where: {
        OR: [
          { status: { in: ['PENDING', 'RETRYABLE_FAILURE'] }, nextAttemptAt: { lte: now } },
          { status: 'PROCESSING', leaseExpiresAt: { lte: now } },
        ],
      },
      orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }],
      take: 100,
      select: { id: true, tenantId: true, participantId: true, refreshVersion: true, attempts: true, nextAttemptAt: true },
    });
    let failed = 0;
    for (const profile of due) {
      try {
        await this.queue.add(
          'instagram.profile.enrich',
          {
            profileId: profile.id,
            tenantId: profile.tenantId,
            participantId: profile.participantId,
            refreshVersion: profile.refreshVersion,
          },
          {
            jobId: `instagram-profile:${profile.id}:v${profile.refreshVersion}:a${profile.attempts}:due${profile.nextAttemptAt.getTime()}`,
            removeOnFail: true,
          },
        );
      } catch {
        failed += 1;
      }
    }
    return { attempted: due.length, failed };
  }
}
