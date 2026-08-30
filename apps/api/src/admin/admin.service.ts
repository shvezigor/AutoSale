import type { PrismaClient } from '@autosale/database';

export class AdminService {
  constructor(private readonly prisma: PrismaClient, private readonly now: () => Date = () => new Date()) {}

  async listTenants() {
    const tenants = await this.prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        status: true,
        createdAt: true,
        memberships: { where: { role: 'OWNER' }, take: 1, select: { user: { select: { email: true } } } },
        _count: { select: { memberships: true, orders: true } },
      },
    });
    return tenants.map((tenant) => ({
      tenantId: tenant.id,
      tenantName: tenant.name,
      status: tenant.status,
      ownerEmail: tenant.memberships[0]?.user.email ?? null,
      userCount: tenant._count.memberships,
      orderCount: tenant._count.orders,
      createdAt: tenant.createdAt.toISOString(),
    }));
  }

  async setTenantStatus(tenantId: string, status: 'ACTIVE' | 'BLOCKED') {
    const result = await this.prisma.tenant.updateMany({ where: { id: tenantId }, data: { status } });
    if (result.count === 0) return null;
    if (status === 'ACTIVE') return { status, revokedSessions: 0 };
    const revoked = await this.prisma.session.updateMany({ where: { tenantId, revokedAt: null }, data: { revokedAt: this.now() } });
    return { status, revokedSessions: revoked.count };
  }
}
