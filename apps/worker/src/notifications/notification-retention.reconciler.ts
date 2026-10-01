const RETENTION_DAYS = 90;
const RETENTION_BATCH_SIZE = 1_000;
const DAY_MS = 24 * 60 * 60_000;

export class NotificationRetentionReconciler {
  constructor(private readonly prisma: PrismaClient) {}

  async reconcile(now = new Date()): Promise<number> {
    const expired = await this.prisma.$queryRaw<Array<{ tenant_id: string; notification_id: string }>>`
      SELECT tenant_id, notification_id
      FROM public.worker_expired_user_notifications(
        ${new Date(now.getTime() - RETENTION_DAYS * DAY_MS)},
        ${RETENTION_BATCH_SIZE}
      )
    `;
    if (expired.length === 0) return 0;

    const byTenant = new Map<string, string[]>();
    for (const row of expired) {
      const ids = byTenant.get(row.tenant_id) ?? [];
      ids.push(row.notification_id);
      byTenant.set(row.tenant_id, ids);
    }

    let deleted = 0;
    for (const [tenantId, ids] of byTenant) {
      const result = await withTenantTransaction(this.prisma, tenantId, (transaction) =>
        transaction.userNotification.deleteMany({ where: { tenantId, id: { in: ids } } }));
      deleted += result.count;
    }
    return deleted;
  }
}
import { type PrismaClient, withTenantTransaction } from '@autosale/database';
