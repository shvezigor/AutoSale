import { describe, expect, it, vi } from 'vitest';

import { InstagramProfileReconciler } from './instagram-profile-reconciler.js';

describe('InstagramProfileReconciler', () => {
  it('queues only the bounded profiles returned by worker discovery', async () => {
    const now = new Date('2026-09-02T10:00:00.000Z');
    const queryRaw = vi.fn().mockResolvedValue([{
      profile_id: '11111111-1111-4111-8111-111111111111',
      tenant_id: '22222222-2222-4222-8222-222222222222',
    }]);
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ set_config: '22222222-2222-4222-8222-222222222222' }]),
      instagramCustomerProfile: {
        findUnique: vi.fn().mockResolvedValue({
          id: '11111111-1111-4111-8111-111111111111',
          tenantId: '22222222-2222-4222-8222-222222222222',
          participantId: 'ig-user-100',
          refreshVersion: 3,
          attempts: 2,
          nextAttemptAt: now,
        }),
      },
    };
    const add = vi.fn().mockResolvedValue(undefined);
    const reconciler = new InstagramProfileReconciler(
      {
        $queryRaw: queryRaw,
        $transaction: async (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction),
      } as never,
      { add } as never,
      () => now,
    );

    await expect(reconciler.reconcile()).resolves.toEqual({ attempted: 1, failed: 0 });
    expect(queryRaw).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledWith(
      'instagram.profile.enrich',
      {
        profileId: '11111111-1111-4111-8111-111111111111',
        tenantId: '22222222-2222-4222-8222-222222222222',
        participantId: 'ig-user-100',
        refreshVersion: 3,
      },
      {
        jobId: 'instagram-profile:11111111-1111-4111-8111-111111111111:v3:a2:due1788343200000',
        removeOnFail: true,
      },
    );
  });
});
