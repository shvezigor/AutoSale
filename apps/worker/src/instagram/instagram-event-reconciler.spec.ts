import { describe, expect, it, vi } from 'vitest';

import { InstagramEventReconciler } from './instagram-event-reconciler.js';

describe('InstagramEventReconciler', () => {
  it('re-enqueues persisted RECEIVED events with stable queue identities', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: '11111111-1111-4111-8111-111111111111' },
      { id: '22222222-2222-4222-8222-222222222222' },
    ]);
    const add = vi.fn().mockResolvedValue(undefined);
    const queryRaw = vi.fn().mockResolvedValue([]);
    const reconciler = new InstagramEventReconciler(
      {
        webhookEvent: { findMany },
        $queryRaw: queryRaw,
      } as never,
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
      { jobId: '11111111-1111-4111-8111-111111111111', removeOnComplete: true, removeOnFail: true },
    );
  });

  it('re-enqueues processed attachment-only messages that were normalized as empty', async () => {
    const findPending = vi.fn().mockResolvedValue([]);
    const queryRaw = vi.fn().mockResolvedValue([
      { event_id: '33333333-3333-4333-8333-333333333333' },
    ]);
    const add = vi.fn().mockResolvedValue(undefined);
    const reconciler = new InstagramEventReconciler(
      {
        webhookEvent: { findMany: findPending },
        $queryRaw: queryRaw,
      } as never,
      { add } as never,
    );

    await expect(reconciler.reconcile()).resolves.toEqual({ attempted: 1, failed: 0 });
    expect(queryRaw).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledWith(
      'instagram.normalize',
      {
        eventId: '33333333-3333-4333-8333-333333333333',
        correlationId: '33333333-3333-4333-8333-333333333333',
      },
      { jobId: 'instagram-attachment-backfill-v2-33333333-3333-4333-8333-333333333333', removeOnComplete: true, removeOnFail: true },
    );
  });

  it('re-enqueues the event for an MP4 that legacy image-only handling rejected', async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      { event_id: '44444444-4444-4444-8444-444444444444' },
    ]);
    const add = vi.fn().mockResolvedValue(undefined);
    const reconciler = new InstagramEventReconciler(
      {
        webhookEvent: { findMany: vi.fn().mockResolvedValue([]) },
        $queryRaw: queryRaw,
      } as never,
      { add } as never,
    );

    await expect(reconciler.reconcile()).resolves.toEqual({ attempted: 1, failed: 0 });
    expect(queryRaw).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledWith(
      'instagram.normalize',
      {
        eventId: '44444444-4444-4444-8444-444444444444',
        correlationId: '44444444-4444-4444-8444-444444444444',
      },
      {
        jobId: 'instagram-attachment-backfill-v2-44444444-4444-4444-8444-444444444444',
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  });

  it('continues after one queue failure so another pending event can recover', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'event-1' }, { id: 'event-2' }]);
    const queryRaw = vi.fn().mockResolvedValue([]);
    const add = vi.fn().mockRejectedValueOnce(new Error('redis unavailable')).mockResolvedValueOnce(undefined);
    const reconciler = new InstagramEventReconciler(
      {
        webhookEvent: { findMany },
        $queryRaw: queryRaw,
      } as never,
      { add } as never,
    );

    await expect(reconciler.reconcile()).resolves.toEqual({ attempted: 2, failed: 1 });
    expect(add).toHaveBeenCalledTimes(2);
  });
});
