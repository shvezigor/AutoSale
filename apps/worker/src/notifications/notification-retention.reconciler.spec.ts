import { describe, expect, it, vi } from 'vitest';

import { NotificationRetentionReconciler } from './notification-retention.reconciler.js';

describe('NotificationRetentionReconciler', () => {
  it('deletes at most 1,000 notifications older than 90 days', async () => {
    const findMany = vi.fn().mockResolvedValue(Array.from({ length: 1_000 }, (_, index) => ({ id: `notification-${index}` })));
    const deleteMany = vi.fn().mockResolvedValue({ count: 1_000 });
    const now = new Date('2026-09-04T12:00:00.000Z');

    const deleted = await new NotificationRetentionReconciler({
      userNotification: { findMany, deleteMany },
    }).reconcile(now);

    expect(findMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date('2026-06-06T12:00:00.000Z') } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: 1_000,
    });
    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: { in: expect.arrayContaining(['notification-0', 'notification-999']) } },
    });
    expect(deleted).toBe(1_000);
  });

  it('does not issue a delete when no expired notifications exist', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const deleteMany = vi.fn();

    await expect(new NotificationRetentionReconciler({
      userNotification: { findMany, deleteMany },
    }).reconcile(new Date('2026-09-04T12:00:00.000Z'))).resolves.toBe(0);

    expect(deleteMany).not.toHaveBeenCalled();
  });
});
