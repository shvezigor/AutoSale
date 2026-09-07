import { describe, expect, it, vi } from 'vitest';

import { InstagramMessageReconciler } from './instagram-message-reconciler.js';

describe('InstagramMessageReconciler', () => {
  const now = new Date('2026-09-07T12:00:00.000Z');

  it('queues at most 50 due pending or expired sending messages with stable job ids', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 'message-a', tenantId: 'tenant-a' },
      { id: 'message-b', tenantId: 'tenant-b' },
    ]);
    const add = vi.fn().mockResolvedValue(undefined);

    await expect(new InstagramMessageReconciler(
      { message: { findMany } } as never,
      { add },
      () => now,
    ).reconcile()).resolves.toEqual({ attempted: 2, queued: 2 });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        direction: 'OUTBOUND',
        OR: [
          { deliveryStatus: 'PENDING', nextDeliveryAttemptAt: { lte: now } },
          { deliveryStatus: 'SENDING', deliveryLeaseExpiresAt: { lte: now } },
        ],
      },
      orderBy: [{ nextDeliveryAttemptAt: 'asc' }, { createdAt: 'asc' }],
      take: 50,
      select: { id: true, tenantId: true },
    });
    expect(add).toHaveBeenNthCalledWith(1, 'instagram.message.send', {
      tenantId: 'tenant-a', messageId: 'message-a',
    }, {
      jobId: 'message-a', attempts: 1, removeOnComplete: true, removeOnFail: true,
    });
  });

  it('continues after a queue wake-up failure and reports only successful enqueues', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 'message-a', tenantId: 'tenant-a' },
      { id: 'message-b', tenantId: 'tenant-b' },
    ]);
    const add = vi.fn()
      .mockRejectedValueOnce(new Error('redis-details-that-must-not-leak'))
      .mockResolvedValueOnce(undefined);

    await expect(new InstagramMessageReconciler(
      { message: { findMany } } as never,
      { add },
      () => now,
    ).reconcile()).resolves.toEqual({ attempted: 2, queued: 1 });
    expect(add).toHaveBeenCalledTimes(2);
  });
});
