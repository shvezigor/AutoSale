import { describe, expect, it, vi } from 'vitest';

import { InstagramEventReconciler } from './instagram-event-reconciler.js';

describe('InstagramEventReconciler', () => {
  it('queues discovered events with their tenant and a stable recovery identity', async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      {
        tenant_id: '11111111-1111-4111-8111-111111111111',
        event_id: '22222222-2222-4222-8222-222222222222',
        recovery_kind: 'RECEIVED',
      },
      {
        tenant_id: '33333333-3333-4333-8333-333333333333',
        event_id: '44444444-4444-4444-8444-444444444444',
        recovery_kind: 'ATTACHMENT_BACKFILL',
      },
    ]);
    const add = vi.fn().mockResolvedValue(undefined);
    const reconciler = new InstagramEventReconciler({ $queryRaw: queryRaw } as never, { add } as never);

    await expect(reconciler.reconcile()).resolves.toEqual({ attempted: 2, failed: 0 });
    expect(queryRaw).toHaveBeenCalledOnce();
    expect(add).toHaveBeenNthCalledWith(
      1,
      'instagram.normalize',
      {
        tenantId: '11111111-1111-4111-8111-111111111111',
        eventId: '22222222-2222-4222-8222-222222222222',
        correlationId: '22222222-2222-4222-8222-222222222222',
      },
      { jobId: '22222222-2222-4222-8222-222222222222', removeOnComplete: true, removeOnFail: true },
    );
    expect(add).toHaveBeenNthCalledWith(
      2,
      'instagram.normalize',
      {
        tenantId: '33333333-3333-4333-8333-333333333333',
        eventId: '44444444-4444-4444-8444-444444444444',
        correlationId: '44444444-4444-4444-8444-444444444444',
      },
      {
        jobId: 'instagram-attachment-backfill-v3-44444444-4444-4444-8444-444444444444',
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  });

  it('continues after one queue failure so another event can recover', async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      { tenant_id: 'tenant-1', event_id: 'event-1', recovery_kind: 'RECEIVED' },
      { tenant_id: 'tenant-2', event_id: 'event-2', recovery_kind: 'RECEIVED' },
    ]);
    const add = vi.fn().mockRejectedValueOnce(new Error('redis unavailable')).mockResolvedValueOnce(undefined);
    const reconciler = new InstagramEventReconciler({ $queryRaw: queryRaw } as never, { add } as never);

    await expect(reconciler.reconcile()).resolves.toEqual({ attempted: 2, failed: 1 });
    expect(add).toHaveBeenCalledTimes(2);
  });
});
