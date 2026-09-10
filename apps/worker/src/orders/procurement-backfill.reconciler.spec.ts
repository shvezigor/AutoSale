import { describe, expect, it, vi } from 'vitest';

import { ProcurementBackfillReconciler } from './procurement-backfill.reconciler.js';

describe('ProcurementBackfillReconciler', () => {
  it('selects a bounded oldest-first batch and isolates assessment failures', async () => {
    const orders = Array.from({ length: 25 }, (_, index) => ({
      id: `order-${index + 1}`,
      tenantId: `tenant-${index + 1}`,
    }));
    const findMany = vi.fn().mockResolvedValue(orders);
    const assessApprovedOrder = vi.fn(async (_tenantId: string, orderId: string) => {
      if (orderId === 'order-2') throw new Error('isolated failure');
      return { orderId, summary: 'READY', items: [{}] };
    });

    await expect(new ProcurementBackfillReconciler(
      { order: { findMany } } as never,
      { assessApprovedOrder } as never,
    ).reconcile()).resolves.toEqual({ attempted: 25, assessed: 24, skipped: 0, failed: 1 });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['APPROVED', 'AUTO_APPROVED'] },
        items: { some: { procurementStatus: 'UNASSESSED' } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 25,
      select: { id: true, tenantId: true },
    });
    expect(assessApprovedOrder).toHaveBeenCalledTimes(25);
    expect(assessApprovedOrder).toHaveBeenNthCalledWith(1, 'tenant-1', 'order-1', 'SYSTEM_BACKFILL');
  });

  it('does not reassess completed work on a later pass', async () => {
    const findMany = vi.fn()
      .mockResolvedValueOnce([{ id: 'order-1', tenantId: 'tenant-1' }])
      .mockResolvedValueOnce([]);
    const assessApprovedOrder = vi.fn().mockResolvedValue({ orderId: 'order-1', summary: 'READY', items: [{}] });
    const reconciler = new ProcurementBackfillReconciler(
      { order: { findMany } } as never,
      { assessApprovedOrder } as never,
    );

    await expect(reconciler.reconcile()).resolves.toEqual({ attempted: 1, assessed: 1, skipped: 0, failed: 0 });
    await expect(reconciler.reconcile()).resolves.toEqual({ attempted: 0, assessed: 0, skipped: 0, failed: 0 });
    expect(assessApprovedOrder).toHaveBeenCalledTimes(1);
  });
});
