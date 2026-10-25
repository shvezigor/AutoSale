import { withTenantTransaction, type PrismaClient } from '@autosale/database';

/** Repairs evidence only: no provider/client or queue dependency is accepted. */
export class AiUsageReconciler {
  constructor(private readonly prisma: PrismaClient, private readonly retentionEnabled = false) {}

  async reconcile(now: Date): Promise<{ unknown: number; purged: number }> {
    const due = await this.prisma.$queryRaw<Array<{ tenant_id: string; attempt_id: string }>>`
      SELECT tenant_id, attempt_id FROM public.worker_due_ai_provider_usage_attempts(${now}, 100)
    `;
    let unknown = 0;
    for (const row of due) {
      const changed = await withTenantTransaction(this.prisma, row.tenant_id, (tx) => tx.aiProviderUsageAttempt.updateMany({
        where: { id: row.attempt_id, tenantId: row.tenant_id, outcome: 'STARTED',
          startedAt: { lt: new Date(now.getTime() - 15 * 60_000) } },
        data: { outcome: 'CHARGE_UNKNOWN', errorCategory: 'ORPHANED', finalizedAt: now,
          returnedModel: null, inputTokens: null, outputTokens: null, cachedInputTokens: null },
      }));
      unknown += changed.count;
    }
    const purged = this.retentionEnabled
      ? (await this.prisma.$queryRaw<Array<{ purged: number }>>`
          SELECT public.worker_purge_ai_provider_usage_attempts(${now}, 100) AS purged
        `)[0]?.purged ?? 0
      : 0;
    return { unknown, purged };
  }
}
