import { randomUUID } from 'node:crypto';

import type { RetentionDryRunJob } from '@autosale/contracts';
import { type Prisma, type PrismaClient, withTenantTransaction } from '@autosale/database';

import { RETENTION_POLICIES, retentionCutoff, type RetentionCategory, type RetentionPolicy } from './retention-policy.js';

const LEASE_MS = 5 * 60_000;

export type RetentionSummaryEntry = {
  category: RetentionCategory;
  policyStatus: RetentionPolicy['status'];
  cutoff: string | null;
  candidateCount: number | null;
  oldestCandidateAt: string | null;
  approximateBytes: number | null;
};

export type RetentionDryRunResult =
  | { status: 'COMPLETED'; summary: RetentionSummaryEntry[] }
  | { status: 'FAILED' | 'IGNORED'; summary: null };

export class RetentionDryRunProcessor {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async process(job: RetentionDryRunJob): Promise<RetentionDryRunResult> {
    const now = this.now();
    const leaseId = randomUUID();
    const claimed = await withTenantTransaction(this.prisma, job.tenantId, (transaction) => transaction.tenantRetentionDryRun.updateMany({
      where: {
        id: job.runId,
        tenantId: job.tenantId,
        OR: [
          { status: { in: ['REQUESTED', 'FAILED'] }, nextAttemptAt: { lte: now } },
          { status: 'PROCESSING', leaseExpiresAt: { lte: now } },
        ],
      },
      data: {
        status: 'PROCESSING', leaseId, leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
        lastErrorCode: null, completedAt: null,
      },
    }));
    if (claimed.count !== 1) return { status: 'IGNORED', summary: null };

    try {
      const summary: RetentionSummaryEntry[] = [];
      for (const policy of RETENTION_POLICIES) {
        const cutoff = retentionCutoff(policy, now);
        if (!cutoff) {
          summary.push({
            category: policy.category, policyStatus: policy.status, cutoff: null,
            candidateCount: null, oldestCandidateAt: null, approximateBytes: null,
          });
          continue;
        }
        const counts = await this.countCandidates(job.tenantId, policy.category, cutoff);
        summary.push({
          category: policy.category, policyStatus: policy.status, cutoff: cutoff.toISOString(),
          candidateCount: counts.count, oldestCandidateAt: counts.oldest?.toISOString() ?? null,
          approximateBytes: null,
        });
      }

      const storedSummary = JSON.parse(JSON.stringify(summary)) as Prisma.InputJsonValue;
      const completed = await withTenantTransaction(this.prisma, job.tenantId, (transaction) => transaction.tenantRetentionDryRun.updateMany({
        where: { id: job.runId, tenantId: job.tenantId, status: 'PROCESSING', leaseId },
        data: { status: 'COMPLETED', summary: storedSummary, completedAt: now, leaseId: null, leaseExpiresAt: null, lastErrorCode: null },
      }));
      return completed.count === 1 ? { status: 'COMPLETED', summary } : { status: 'IGNORED', summary: null };
    } catch {
      await withTenantTransaction(this.prisma, job.tenantId, (transaction) => transaction.tenantRetentionDryRun.updateMany({
        where: { id: job.runId, tenantId: job.tenantId, status: 'PROCESSING', leaseId },
        data: {
          status: 'FAILED', lastErrorCode: 'RETENTION_DRY_RUN_FAILED', nextAttemptAt: new Date(now.getTime() + 5 * 60_000),
          leaseId: null, leaseExpiresAt: null,
        },
      }));
      return { status: 'FAILED', summary: null };
    }
  }

  private countCandidates(tenantId: string, category: RetentionCategory, cutoff: Date): Promise<{ count: number; oldest: Date | null }> {
    return withTenantTransaction(this.prisma, tenantId, async (transaction) => {
      switch (category) {
        case 'RAW_WEBHOOKS': {
          const where = { tenantId, receivedAt: { lt: cutoff } };
          const [count, oldest] = await Promise.all([
            transaction.webhookEvent.count({ where }),
            transaction.webhookEvent.aggregate({ where, _min: { receivedAt: true } }),
          ]);
          return { count, oldest: oldest._min.receivedAt };
        }
        case 'USER_NOTIFICATIONS': {
          const where = { tenantId, createdAt: { lt: cutoff } };
          const [count, oldest] = await Promise.all([
            transaction.userNotification.count({ where }),
            transaction.userNotification.aggregate({ where, _min: { createdAt: true } }),
          ]);
          return { count, oldest: oldest._min.createdAt };
        }
        case 'SECURITY_AUDIT': {
          const where = { tenantId, createdAt: { lt: cutoff } };
          const [count, oldest] = await Promise.all([
            transaction.securityAuditLog.count({ where }),
            transaction.securityAuditLog.aggregate({ where, _min: { createdAt: true } }),
          ]);
          return { count, oldest: oldest._min.createdAt };
        }
        default:
          return { count: 0, oldest: null };
      }
    });
  }
}
