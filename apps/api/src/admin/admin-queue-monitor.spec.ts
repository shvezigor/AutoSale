import { describe, expect, it, vi } from 'vitest';

import { BullAdminQueueMonitor } from './admin-queue-monitor.js';

describe('BullAdminQueueMonitor', () => {
  it('normalizes BullMQ counts and reads only the oldest pending timestamp', async () => {
    const queue = {
      getJobCounts: vi.fn().mockResolvedValue({ wait: 2, active: 1, delayed: 3, failed: 4, completed: 5 }),
      getWorkers: vi.fn().mockResolvedValue([{ id: 'worker-1' }]),
      getJobs: vi.fn().mockResolvedValue([{ timestamp: 1_780_000_000_000, data: { customerPhone: '+380000000000' } }]),
    };
    const monitor = new BullAdminQueueMonitor('instagram', queue as never);

    await expect(monitor.getJobCounts()).resolves.toEqual({ waiting: 2, active: 1, delayed: 3, failed: 4, completed: 5 });
    await expect(monitor.getWorkers()).resolves.toHaveLength(1);
    await expect(monitor.getOldestPendingAt()).resolves.toEqual(new Date(1_780_000_000_000));
    expect(queue.getJobs).toHaveBeenCalledWith(['wait', 'delayed'], 0, 0, true);
  });
});
