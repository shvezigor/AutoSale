import { describe, expect, it, vi } from 'vitest';

import { NotificationRetentionReconciler } from './notification-retention.reconciler.js';

describe('NotificationRetentionReconciler', () => {
  it('deletes at most 1,000 notifications older than 90 days', async () => {
    const authorityQuery = vi.fn().mockResolvedValue(Array.from({ length: 1_000 }, (_, index) => ({ tenant_id: '11111111-1111-4111-8111-111111111111', notification_id: `notification-${index}` })));
    const deleteMany = vi.fn().mockResolvedValue({ count: 1_000 });
    const now = new Date('2026-09-04T12:00:00.000Z');

    const deleted = await new NotificationRetentionReconciler({
      $queryRaw: authorityQuery,
      $transaction: async (operation: (transaction: unknown) => Promise<unknown>) => operation({
        $queryRaw: vi.fn().mockResolvedValue([]), userNotification: { deleteMany },
      }),
    } as never).reconcile(now);

    expect(authorityQuery).toHaveBeenCalledTimes(1);
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        tenantId: '11111111-1111-4111-8111-111111111111',
        id: { in: expect.arrayContaining(['notification-0', 'notification-999']) },
      },
    });
    expect(deleted).toBe(1_000);
  });

  it('does not issue a delete when no expired notifications exist', async () => {
    const authorityQuery = vi.fn().mockResolvedValue([]);
    const deleteMany = vi.fn();

    await expect(new NotificationRetentionReconciler({
      $queryRaw: authorityQuery,
      $transaction: vi.fn(),
    } as never).reconcile(new Date('2026-09-04T12:00:00.000Z'))).resolves.toBe(0);

    expect(deleteMany).not.toHaveBeenCalled();
  });
});
