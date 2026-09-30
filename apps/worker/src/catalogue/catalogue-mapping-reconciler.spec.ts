import { describe, expect, it, vi } from 'vitest';

import { CatalogueMappingReconciler } from './catalogue-mapping-reconciler.js';

describe('CatalogueMappingReconciler', () => {
  it('durably dispatches an uploaded run when the API enqueue never happened', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ run_id: 'run-1', tenant_id: 'tenant-1', updated_at: new Date('2026-09-05T10:00:00.000Z') }]);
    const add = vi.fn().mockResolvedValue(undefined);

    await expect(new CatalogueMappingReconciler({ $queryRaw: queryRaw } as never, { add }).reconcile())
      .resolves.toEqual({ attempted: 1, enqueued: 1 });

    expect(add).toHaveBeenCalledWith('catalogue.mapping', { tenantId: 'tenant-1', runId: 'run-1' }, expect.objectContaining({ jobId: 'catalogue.mapping:run-1:1788602400000' }));
  });

  it('leaves durable candidates for a later retry when queueing fails', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ run_id: 'run-2', tenant_id: 'tenant-2', updated_at: new Date('2026-09-05T10:00:00.000Z') }]);
    const add = vi.fn().mockRejectedValueOnce(new Error('redis unavailable')).mockResolvedValueOnce(undefined);
    const reconciler = new CatalogueMappingReconciler({ $queryRaw: queryRaw } as never, { add });

    await expect(reconciler.reconcile()).resolves.toEqual({ attempted: 1, enqueued: 0 });
    await expect(reconciler.reconcile()).resolves.toEqual({ attempted: 1, enqueued: 1 });
    expect(add).toHaveBeenCalledTimes(2);
  });
});
