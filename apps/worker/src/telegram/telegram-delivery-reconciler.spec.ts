import { describe, expect, it, vi } from 'vitest';

import { TelegramDeliveryReconciler } from './telegram-delivery-reconciler.js';

describe('TelegramDeliveryReconciler', () => {
  const now = new Date('2026-09-08T12:00:00.000Z');

  it('recovers due deliveries and expired leases with stable queue jobs', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: '11111111-1111-4111-8111-111111111111' },
      { id: '22222222-2222-4222-8222-222222222222' },
    ]);
    const add = vi.fn().mockResolvedValue(undefined);

    await expect(new TelegramDeliveryReconciler(
      { telegramDelivery: { findMany } } as never,
      { add },
      () => now,
    ).reconcile()).resolves.toEqual({ attempted: 2, queued: 2 });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { status: { in: ['PENDING', 'RETRYABLE'] }, nextAttemptAt: { lte: now } },
          { status: 'PROCESSING', leaseExpiresAt: { lte: now } },
        ],
      },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
      take: 50,
      select: { id: true },
    });
    expect(add).toHaveBeenNthCalledWith(1, 'telegram.deliver', {
      deliveryId: '11111111-1111-4111-8111-111111111111',
    }, {
      jobId: 'telegram:11111111-1111-4111-8111-111111111111',
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
    });
  });

  it('leaves a failed queue wake-up recoverable by the next pass', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: '11111111-1111-4111-8111-111111111111' },
      { id: '22222222-2222-4222-8222-222222222222' },
    ]);
    const add = vi.fn()
      .mockRejectedValueOnce(new Error('redis details must stay internal'))
      .mockResolvedValueOnce(undefined);

    await expect(new TelegramDeliveryReconciler(
      { telegramDelivery: { findMany } } as never,
      { add },
      () => now,
    ).reconcile()).resolves.toEqual({ attempted: 2, queued: 1 });

    expect(add).toHaveBeenCalledTimes(2);
  });
});
