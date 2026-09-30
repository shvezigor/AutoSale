import { describe, expect, it, vi } from 'vitest';

import { CatalogueSyncScheduler } from './catalogue-sync-scheduler.js';

describe('CatalogueSyncScheduler', () => {
  it('paginates the due query and schedules every due source exactly once', async () => {
    const first = Array.from({ length: 100 }, (_, index) => ({ source_id: `source-${String(index).padStart(3, '0')}`, tenant_id: 'tenant', sync_schedule: 'HOURLY' }));
    const second = [{ source_id: 'source-100', tenant_id: 'tenant', sync_schedule: 'DAILY' }];
    const prisma = { $queryRaw: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second) };
    const queue = { add: vi.fn().mockResolvedValue({}) };
    const now = new Date('2026-09-01T12:00:00.000Z');

    await expect(new CatalogueSyncScheduler(prisma as never, queue).scheduleDue(now)).resolves.toEqual({ attempted: 101 });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenCalledTimes(101);
    expect(queue.add).toHaveBeenLastCalledWith('catalogue.sync', { tenantId: 'tenant', sourceId: 'source-100' }, expect.objectContaining({
      jobId: expect.stringMatching(/^catalogue\.sync:source-100:\d+$/),
    }));
  });
});
