import type { PrismaClient } from '@autosale/database';
import { withTenantTransaction } from '@autosale/database';
import type { StreamingObjectStorage } from '@autosale/integrations';

type LifecycleQueue = {
  add(
    name: string,
    data: { tenantId: string; requestId: string } | { tenantId: string; runId: string },
    options: Record<string, unknown>,
  ): Promise<unknown>;
};

type DirectoryRow = { tenant_id: string; request_id: string };
type RetentionDirectoryRow = { tenant_id: string; run_id: string };

export class TenantLifecycleReconciler {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly queue: LifecycleQueue,
    private readonly storage: Pick<StreamingObjectStorage, 'delete'>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async reconcile(): Promise<{ attempted: number; enqueued: number; failed: number }> {
    const now = this.now();
    const rows = await this.prisma.$queryRaw<DirectoryRow[]>`
      SELECT tenant_id, request_id
      FROM worker_due_tenant_lifecycle_requests(${now}, 50)
    `;
    let enqueued = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        await this.queue.add('tenant-lifecycle.export', { tenantId: row.tenant_id, requestId: row.request_id }, {
          jobId: `tenant-lifecycle-${row.request_id}-${Math.floor(now.getTime() / 5_000)}`,
          attempts: 1,
          removeOnComplete: 100,
          removeOnFail: 250,
        });
        enqueued += 1;
      } catch {
        failed += 1;
      }
    }
    return { attempted: rows.length, enqueued, failed };
  }

  async cleanupExpired(): Promise<{ attempted: number; deleted: number; failed: number }> {
    const now = this.now();
    const rows = await this.prisma.$queryRaw<DirectoryRow[]>`
      SELECT tenant_id, request_id
      FROM worker_due_tenant_lifecycle_artifact_cleanups(${now}, 50)
    `;
    let deleted = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        const candidate = await withTenantTransaction(this.prisma, row.tenant_id, (transaction) =>
          transaction.tenantLifecycleRequest.findFirst({
            where: {
              id: row.request_id,
              tenantId: row.tenant_id,
              status: 'EXPORT_READY',
              exportObjectKey: { not: null },
              exportExpiresAt: { lte: now },
            },
            select: { exportObjectKey: true, exportExpiresAt: true },
          }));
        if (!candidate?.exportObjectKey || !candidate.exportExpiresAt) continue;
        await this.storage.delete(candidate.exportObjectKey);
        const cleared = await withTenantTransaction(this.prisma, row.tenant_id, (transaction) =>
          transaction.tenantLifecycleRequest.updateMany({
            where: {
              id: row.request_id,
              tenantId: row.tenant_id,
              status: 'EXPORT_READY',
              exportObjectKey: candidate.exportObjectKey,
              exportExpiresAt: candidate.exportExpiresAt,
            },
            data: {
              exportObjectKey: null,
              exportExpiresAt: null,
              exportSizeBytes: null,
              exportManifestVersion: null,
            },
          }));
        if (cleared.count > 0) deleted += 1;
      } catch {
        failed += 1;
      }
    }
    return { attempted: rows.length, deleted, failed };
  }

  async reconcileRetention(): Promise<{ attempted: number; enqueued: number; failed: number }> {
    const now = this.now();
    const rows = await this.prisma.$queryRaw<RetentionDirectoryRow[]>`
      SELECT tenant_id, run_id
      FROM worker_due_retention_dry_runs(${now}, 50)
    `;
    let enqueued = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        await this.queue.add('tenant-lifecycle.retention-dry-run', { tenantId: row.tenant_id, runId: row.run_id }, {
          jobId: `retention-dry-run-${row.run_id}`,
          attempts: 1,
          removeOnComplete: 100,
          removeOnFail: 250,
        });
        enqueued += 1;
      } catch {
        failed += 1;
      }
    }
    return { attempted: rows.length, enqueued, failed };
  }
}
