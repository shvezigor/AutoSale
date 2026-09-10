import type { PrismaClient, ProcurementStore } from '@autosale/database';

export type ProcurementBackfillResult = {
  attempted: number;
  assessed: number;
  skipped: number;
  failed: number;
};

export class ProcurementBackfillReconciler {
  constructor(
    private readonly prisma: Pick<PrismaClient, 'order'>,
    private readonly procurement: Pick<ProcurementStore, 'assessApprovedOrder'>,
  ) {}

  async reconcile(): Promise<ProcurementBackfillResult> {
    const orders = await this.prisma.order.findMany({
      where: {
        status: { in: ['APPROVED', 'AUTO_APPROVED'] },
        items: { some: { procurementStatus: 'UNASSESSED' } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 25,
      select: { id: true, tenantId: true },
    });
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
