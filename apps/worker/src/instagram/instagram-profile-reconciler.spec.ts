import { describe, expect, it, vi } from 'vitest';

import { InstagramProfileReconciler } from './instagram-profile-reconciler.js';

describe('InstagramProfileReconciler', () => {
  it('queues due profiles with a tenant, participant, and version-stable job id', async () => {
    const now = new Date('2026-09-02T10:00:00.000Z');
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findMany = vi.fn().mockResolvedValue([{
      id: '11111111-1111-4111-8111-111111111111',
      tenantId: '22222222-2222-4222-8222-222222222222',
      participantId: 'ig-user-100',
      refreshVersion: 3,
    }]);
    const add = vi.fn().mockResolvedValue(undefined);
    const reconciler = new InstagramProfileReconciler(
      { instagramCustomerProfile: { updateMany, findMany } } as never,
      { add } as never,
      () => now,
    );

    await expect(reconciler.reconcile()).resolves.toEqual({ attempted: 1, failed: 0 });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['READY', 'UNAVAILABLE'] },
        refreshAfter: { lte: now },
      },
      data: {
        status: 'PENDING',
        nextAttemptAt: now,
        refreshVersion: { increment: 1 },
      },
    });
    expect(add).toHaveBeenCalledWith(
      'instagram.profile.enrich',
      {
        profileId: '11111111-1111-4111-8111-111111111111',
        tenantId: '22222222-2222-4222-8222-222222222222',
        participantId: 'ig-user-100',
        refreshVersion: 3,
      },
      {
        jobId: 'instagram-profile:11111111-1111-4111-8111-111111111111:v3',
        removeOnFail: true,
      },
    );
  });
});
