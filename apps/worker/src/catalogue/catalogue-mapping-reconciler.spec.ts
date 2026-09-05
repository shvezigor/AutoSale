import { describe, expect, it, vi } from 'vitest';

import { CatalogueMappingReconciler } from './catalogue-mapping-reconciler.js';

describe('CatalogueMappingReconciler', () => {
  it('durably dispatches an uploaded run when the API enqueue never happened', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'run-1', tenantId: 'tenant-1', updatedAt: new Date('2026-09-05T10:00:00.000Z') }]);
    const add = vi.fn().mockResolvedValue(undefined);

    await expect(new CatalogueMappingReconciler({ catalogueImportRun: { findMany } } as never, { add }).reconcile())
      .resolves.toEqual({ attempted: 1, enqueued: 1 });

    expect(add).toHaveBeenCalledWith('catalogue.mapping', { tenantId: 'tenant-1', runId: 'run-1' }, expect.objectContaining({ jobId: 'catalogue.mapping:run-1:1788602400000' }));
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ OR: expect.arrayContaining([expect.objectContaining({ status: 'UPLOADED' }), expect.objectContaining({ status: 'MAPPING', mappingLeaseId: { not: null }, mappingLeaseExpiresAt: { lt: expect.any(Date) } })]) }) }));
  });

  it('leaves durable candidates for a later retry when queueing fails', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'run-2', tenantId: 'tenant-2', updatedAt: new Date('2026-09-05T10:00:00.000Z') }]);
    const add = vi.fn().mockRejectedValueOnce(new Error('redis unavailable')).mockResolvedValueOnce(undefined);
    const reconciler = new CatalogueMappingReconciler({ catalogueImportRun: { findMany } } as never, { add });

    await expect(reconciler.reconcile()).resolves.toEqual({ attempted: 1, enqueued: 0 });
    await expect(reconciler.reconcile()).resolves.toEqual({ attempted: 1, enqueued: 1 });
    expect(add).toHaveBeenCalledTimes(2);
  });
});
