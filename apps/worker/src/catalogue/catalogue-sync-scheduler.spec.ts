import { describe, expect, it, vi } from 'vitest';

import { CatalogueSyncScheduler } from './catalogue-sync-scheduler.js';

describe('CatalogueSyncScheduler', () => {
  it('paginates the due query and schedules every due source exactly once', async () => {
    const first = Array.from({ length: 100 }, (_, index) => ({ id: `source-${String(index).padStart(3, '0')}`, tenantId: 'tenant', syncSchedule: 'HOURLY' }));
    const second = [{ id: 'source-100', tenantId: 'tenant', syncSchedule: 'DAILY' }];
    const prisma = { catalogueSource: { findMany: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second) } };
    const queue = { add: vi.fn().mockResolvedValue({}) };
    const now = new Date('2026-09-01T12:00:00.000Z');

    await expect(new CatalogueSyncScheduler(prisma as never, queue).scheduleDue(now)).resolves.toEqual({ attempted: 101 });
    expect(prisma.catalogueSource.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.catalogueSource.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { type: 'GOOGLE_SHEETS', status: 'ACTIVE', syncSchedule: { in: ['HOURLY', 'DAILY'] }, nextSyncAt: { lte: now } },
      orderBy: { id: 'asc' }, take: 100,
    }));
    expect(prisma.catalogueSource.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: { id: 'source-099' }, skip: 1 }));
    expect(queue.add).toHaveBeenCalledTimes(101);
  });
});
