import { describe, expect, it, vi } from 'vitest';

import { TenantLifecycleReconciler } from './tenant-lifecycle.reconciler.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';

describe('TenantLifecycleReconciler', () => {
  it('enqueues bounded due work with a versioned job identifier', async () => {
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([{ tenant_id: tenantId, request_id: requestId }]) };
    const queue = { add: vi.fn().mockResolvedValue(undefined) };
    const reconciler = new TenantLifecycleReconciler(prisma as never, queue, { delete: vi.fn() } as never, () => new Date('2026-10-02T09:00:00Z'));

    await expect(reconciler.reconcile()).resolves.toEqual({ attempted: 1, enqueued: 1, failed: 0 });
    expect(queue.add).toHaveBeenCalledWith('tenant-lifecycle.export', { tenantId, requestId }, expect.objectContaining({
      jobId: expect.stringMatching(new RegExp(`^tenant-lifecycle-${requestId}-`)), attempts: 1,
    }));
  });

  it('deletes an expired object and clears only download metadata', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $queryRaw: vi.fn(),
      tenantLifecycleRequest: {
        findFirst: vi.fn().mockResolvedValue({ exportObjectKey: 'tenant-lifecycle/private/export.zip', exportExpiresAt: new Date('2026-10-01T09:00:00Z') }),
        updateMany,
      },
    };
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ tenant_id: tenantId, request_id: requestId }]),
      $transaction: vi.fn(async (operation: (value: unknown) => Promise<unknown>) => operation(tx)),
    };
    const storage = { delete: vi.fn().mockResolvedValue(undefined) };
    const reconciler = new TenantLifecycleReconciler(prisma as never, { add: vi.fn() }, storage as never, () => new Date('2026-10-02T09:00:00Z'));

    await expect(reconciler.cleanupExpired()).resolves.toEqual({ attempted: 1, deleted: 1, failed: 0 });
    expect(storage.delete).toHaveBeenCalledWith('tenant-lifecycle/private/export.zip');
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ exportObjectKey: null, exportExpiresAt: null }),
    }));
    expect(updateMany.mock.calls[0]![0].data).not.toHaveProperty('exportSha256');
    expect(updateMany.mock.calls[0]![0].data).not.toHaveProperty('exportReadyAt');
  });

  it('recovers a due retention dry-run without putting summary data in the queue', async () => {
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([{ tenant_id: tenantId, run_id: requestId }]) };
    const queue = { add: vi.fn().mockResolvedValue(undefined) };
    const reconciler = new TenantLifecycleReconciler(prisma as never, queue, { delete: vi.fn() } as never, () => new Date('2026-10-02T09:00:00Z'));

    await expect(reconciler.reconcileRetention()).resolves.toEqual({ attempted: 1, enqueued: 1, failed: 0 });
    expect(queue.add).toHaveBeenCalledWith(
      'tenant-lifecycle.retention-dry-run', { tenantId, runId: requestId },
      expect.objectContaining({ jobId: `retention-dry-run-${requestId}`, attempts: 1 }),
    );
  });
});
