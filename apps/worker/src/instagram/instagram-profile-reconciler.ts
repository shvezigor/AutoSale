import { type PrismaClient, withTenantTransaction } from '@autosale/database';

import type { InstagramProfileEnrichmentJob } from './instagram-profile-enrichment.service.js';

interface ProfileQueue {
  add(
    name: 'instagram.profile.enrich',
    data: InstagramProfileEnrichmentJob,
    options: { jobId: string; removeOnFail: true },
  ): Promise<unknown>;
}

interface DueInstagramProfile {
  tenant_id: string;
  profile_id: string;
}

export class InstagramProfileReconciler {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly queue: ProfileQueue,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async reconcile(): Promise<{ attempted: number; failed: number }> {
    const now = this.now();
    const due = await this.prisma.$queryRaw<DueInstagramProfile[]>`
      SELECT tenant_id, profile_id
      FROM public.worker_due_instagram_profiles(${now}, 100)
    `;
    let failed = 0;
    for (const discovered of due) {
      try {
        const profile = await withTenantTransaction(this.prisma, discovered.tenant_id, (transaction) =>
          transaction.instagramCustomerProfile.findUnique({
            where: { id: discovered.profile_id },
            select: {
              id: true,
              tenantId: true,
              participantId: true,
              refreshVersion: true,
              attempts: true,
              nextAttemptAt: true,
            },
          }));
        if (!profile) continue;
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
