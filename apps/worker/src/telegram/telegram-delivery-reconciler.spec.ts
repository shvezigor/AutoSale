import { describe, expect, it, vi } from 'vitest';

import { TelegramDeliveryReconciler } from './telegram-delivery-reconciler.js';

describe('TelegramDeliveryReconciler', () => {
  const now = new Date('2026-09-08T12:00:00.000Z');

  it('recovers due deliveries and expired leases with stable queue jobs', async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      {
        tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        delivery_id: '11111111-1111-4111-8111-111111111111',
        purpose: 'TEST',
      },
      {
        tenant_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        delivery_id: '22222222-2222-4222-8222-222222222222',
        purpose: 'SUPPLIER_ORDER',
      },
    ]);
    const add = vi.fn().mockResolvedValue(undefined);

    await expect(new TelegramDeliveryReconciler(
      { $queryRaw: queryRaw } as never,
      { add },
      () => now,
    ).reconcile()).resolves.toEqual({ attempted: 2, queued: 2 });

    expect(queryRaw).toHaveBeenCalledTimes(1);
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
    const queryRaw = vi.fn().mockResolvedValue([
      {
        tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        delivery_id: '11111111-1111-4111-8111-111111111111',
        purpose: 'TEST',
      },
      {
        tenant_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        delivery_id: '22222222-2222-4222-8222-222222222222',
        purpose: 'PERSONAL_ALERT',
      },
    ]);
    const add = vi.fn()
      .mockRejectedValueOnce(new Error('redis details must stay internal'))
      .mockResolvedValueOnce(undefined);

    await expect(new TelegramDeliveryReconciler(
      { $queryRaw: queryRaw } as never,
      { add },
      () => now,
    ).reconcile()).resolves.toEqual({ attempted: 2, queued: 1 });

    expect(add).toHaveBeenCalledTimes(2);
  });
});
