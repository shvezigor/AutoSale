import { Prisma, type PrismaClient } from '@autosale/database';

export class AdminService {
  constructor(private readonly prisma: PrismaClient, private readonly now: () => Date = () => new Date()) {}

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
}

type PlatformTenantRow = {
  tenant_id: string;
  tenant_name: string;
  tenant_status: 'ACTIVE' | 'BLOCKED';
  owner_email: string | null;
  user_count: bigint;
  created_at: Date;
};
