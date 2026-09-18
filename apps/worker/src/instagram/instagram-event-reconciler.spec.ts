import { describe, expect, it, vi } from 'vitest';

import { InstagramEventReconciler } from './instagram-event-reconciler.js';

describe('InstagramEventReconciler', () => {
  it('re-enqueues persisted RECEIVED events with stable queue identities', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: '11111111-1111-4111-8111-111111111111' },
      { id: '22222222-2222-4222-8222-222222222222' },
    ]);
    const add = vi.fn().mockResolvedValue(undefined);
    const reconciler = new InstagramEventReconciler(
      { webhookEvent: { findMany } } as never,
      { add } as never,
    );

    await expect(reconciler.reconcile()).resolves.toEqual({ attempted: 2, failed: 0 });
    expect(findMany).toHaveBeenCalledWith({
      where: { provider: 'META', status: 'RECEIVED' },
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
      take: 100,
      select: { id: true },
    });
    expect(add).toHaveBeenNthCalledWith(
      1,
      'instagram.normalize',
      {
        eventId: '11111111-1111-4111-8111-111111111111',
        correlationId: '11111111-1111-4111-8111-111111111111',
      },
      { jobId: '11111111-1111-4111-8111-111111111111', removeOnFail: true },
    );
  });

  it('continues after one queue failure so another pending event can recover', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'event-1' }, { id: 'event-2' }]);
    const add = vi.fn().mockRejectedValueOnce(new Error('redis unavailable')).mockResolvedValueOnce(undefined);
    const reconciler = new InstagramEventReconciler(
      { webhookEvent: { findMany } } as never,
      { add } as never,
    );

    await expect(reconciler.reconcile()).resolves.toEqual({ attempted: 2, failed: 1 });
    expect(add).toHaveBeenCalledTimes(2);
  });
});
