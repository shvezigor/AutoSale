import { Prisma, type PrismaClient } from '@autosale/database';
import type { AdminQueueName, AdminQueueSummary, AdminOperationsSummary, AdminPlatformOverview } from '@autosale/contracts/auth';

type QueueCounts = Pick<AdminQueueSummary, 'waiting' | 'active' | 'delayed' | 'failed' | 'completed'>;

export interface AdminQueueMonitor {
  name: AdminQueueName;
  getJobCounts(): Promise<QueueCounts>;
  getWorkers(): Promise<unknown[]>;
  getOldestPendingAt(): Promise<Date | null>;
}

export class AdminService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
    private readonly queues: AdminQueueMonitor[] = [],
  ) {}

  async listTenants() {
    const [tenants, orderCounts] = await Promise.all([
      this.prisma.$queryRaw<PlatformTenantRow[]>(Prisma.sql`
        SELECT tenant_id, tenant_name, tenant_status, owner_email, user_count, created_at
        FROM public.platform_tenant_directory()
        ORDER BY created_at DESC
      `),
      this.prisma.$queryRaw<Array<{ tenantId: string; orderCount: bigint }>>(Prisma.sql`
        SELECT tenant_id AS "tenantId", order_count AS "orderCount"
        FROM public.platform_order_counts()
      `),
    ]);
    const ordersByTenant = new Map(orderCounts.map((row) => [row.tenantId, Number(row.orderCount)]));
    return tenants.map((tenant) => ({
      tenantId: tenant.tenant_id,
      tenantName: tenant.tenant_name,
      status: tenant.tenant_status,
      ownerEmail: tenant.owner_email,
      userCount: Number(tenant.user_count),
      orderCount: ordersByTenant.get(tenant.tenant_id) ?? 0,
      createdAt: tenant.created_at.toISOString(),
    }));
  }

  async setTenantStatus(tenantId: string, status: 'ACTIVE' | 'BLOCKED') {
    const result = await this.prisma.tenant.updateMany({ where: { id: tenantId }, data: { status } });
    if (result.count === 0) return null;
    if (status === 'ACTIVE') return { status, revokedSessions: 0 };
    const revoked = await this.prisma.$queryRaw<Array<{ revoked_count: number }>>`
      SELECT revoked_count FROM public.api_revoke_sessions(NULL::uuid, NULL::uuid, ${tenantId}::uuid, ${this.now()})
    `;
    return { status, revokedSessions: revoked[0]?.revoked_count ?? 0 };
  }

  async getTenant(tenantId: string) {
    return (await this.listTenants()).find((tenant) => tenant.tenantId === tenantId) ?? null;
  }

  async getOverview(): Promise<AdminPlatformOverview> {
    const [tenants, operations] = await Promise.all([this.listTenants(), this.getOperations()]);
    const thirtyDaysAgo = new Date(this.now().getTime() - 30 * 24 * 60 * 60 * 1000);
    return {
      status: operations.status,
      attentionQueueCount: operations.queues.filter((queue) => queue.status === 'ATTENTION').length,
      updatedAt: operations.updatedAt,
      metrics: {
        tenantCount: tenants.length,
        activeTenantCount: tenants.filter((tenant) => tenant.status === 'ACTIVE').length,
        blockedTenantCount: tenants.filter((tenant) => tenant.status === 'BLOCKED').length,
        userCount: tenants.reduce((total, tenant) => total + tenant.userCount, 0),
        orderCount: tenants.reduce((total, tenant) => total + tenant.orderCount, 0),
        newTenantCount30Days: tenants.filter((tenant) => new Date(tenant.createdAt) >= thirtyDaysAgo).length,
      },
    };
  }

  async getOperations(): Promise<AdminOperationsSummary> {
    const queues = await Promise.all(this.queues.map((queue) => inspectQueue(queue)));
    return {
      status: queues.some((queue) => queue.status === 'ATTENTION') ? 'DEGRADED' : 'HEALTHY',
      database: 'HEALTHY',
      updatedAt: this.now().toISOString(),
      queues,
    };
  }
}

async function inspectQueue(queue: AdminQueueMonitor): Promise<AdminQueueSummary> {
  try {
    const [counts, workers, oldestPendingAt] = await Promise.all([
      queue.getJobCounts(), queue.getWorkers(), queue.getOldestPendingAt(),
    ]);
    const pending = counts.waiting + counts.active + counts.delayed;
    const status: AdminQueueSummary['status'] = counts.failed > 0 || (pending > 0 && workers.length === 0)
      ? 'ATTENTION'
      : workers.length === 0
        ? 'IDLE'
        : 'HEALTHY';
    return {
      queue: queue.name,
      status,
      ...counts,
      workerCount: workers.length,
      oldestPendingAt: oldestPendingAt?.toISOString() ?? null,
      available: true,
    };
  } catch {
    return {
      queue: queue.name,
      status: 'ATTENTION',
      waiting: 0,
      active: 0,
      delayed: 0,
      failed: 0,
      completed: 0,
      workerCount: 0,
      oldestPendingAt: null,
      available: false,
    };
  }
}

type PlatformTenantRow = {
  tenant_id: string;
  tenant_name: string;
  tenant_status: 'ACTIVE' | 'BLOCKED';
  owner_email: string | null;
  user_count: bigint;
  created_at: Date;
};
