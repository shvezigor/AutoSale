import { describe, expect, it, vi } from 'vitest';

import { TikTokMessageReconciler } from './tiktok-message-reconciler.js';

describe('TikTokMessageReconciler', () => {
  it('queues due safe sends with stable job IDs', async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const query = vi.fn()
      .mockResolvedValueOnce([{ marked_unknown: 2 }])
      .mockResolvedValueOnce([
        { tenant_id: 'tenant-a', message_id: 'message-a' },
        { tenant_id: 'tenant-b', message_id: 'message-b' },
      ]);

    await expect(new TikTokMessageReconciler(
      { $queryRaw: query } as never,
      { add },
      () => new Date('2026-10-04T09:00:00.000Z'),
    ).reconcile()).resolves.toEqual({ attempted: 2, queued: 2, markedUnknown: 2 });

    expect(add).toHaveBeenNthCalledWith(1, 'tiktok.message.send', {
      tenantId: 'tenant-a', messageId: 'message-a',
    }, { jobId: 'message-a', attempts: 1, removeOnComplete: true, removeOnFail: true });
  });

  it('keeps failed wakeups pending for a later reconciliation pass', async () => {
    const add = vi.fn().mockRejectedValue(new Error('redis unavailable'));
    const query = vi.fn()
      .mockResolvedValueOnce([{ marked_unknown: 0 }])
      .mockResolvedValueOnce([{ tenant_id: 'tenant-a', message_id: 'message-a' }]);

    await expect(new TikTokMessageReconciler(
      { $queryRaw: query } as never, { add },
    ).reconcile()).resolves.toEqual({ attempted: 1, queued: 0, markedUnknown: 0 });
  });
});
