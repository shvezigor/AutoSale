import { type PrismaClient, type ProcurementStore, withTenantTransaction } from '@autosale/database';

export type ProcurementBackfillResult = {
  attempted: number;
  assessed: number;
  skipped: number;
  failed: number;
};

export class ProcurementBackfillReconciler {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly procurement: Pick<ProcurementStore, 'assessApprovedOrder'>,
  ) {}

  async reconcile(): Promise<ProcurementBackfillResult> {
    const tenants = await this.prisma.tenant.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    const candidates: Array<{ id: string; tenantId: string; createdAt: Date }> = [];
    for (const tenant of tenants) {
      const tenantOrders = await withTenantTransaction(this.prisma, tenant.id, (tx) => tx.order.findMany({
        where: {
          tenantId: tenant.id,
          status: { in: ['APPROVED', 'AUTO_APPROVED'] },
          items: { some: { procurementStatus: 'UNASSESSED' } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 25,
        select: { id: true, tenantId: true, createdAt: true },
      }));
      candidates.push(...tenantOrders);
    }
    const orders = candidates
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id))
      .slice(0, 25);
    const result: ProcurementBackfillResult = {
      attempted: orders.length,
      assessed: 0,
      skipped: 0,
      failed: 0,
    };

    for (const order of orders) {
      try {
        const assessment = await this.procurement.assessApprovedOrder(
          order.tenantId,
          order.id,
          'SYSTEM_BACKFILL',
        );
        if (assessment.items.length === 0) result.skipped += 1;
        else result.assessed += 1;
      } catch {
        result.failed += 1;
      }
    }
    return result;
  }
}
