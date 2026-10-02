import type { AdminQueueName } from '@autosale/contracts/auth';

import type { AdminQueueMonitor } from './admin.service.js';

type BullQueueReader = {
  getJobCounts(): Promise<Record<string, number>>;
  getWorkers(): Promise<unknown[]>;
  getJobs(types: Array<'wait' | 'delayed'>, start: number, end: number, asc: boolean): Promise<Array<{ timestamp: number }>>;
};

export class BullAdminQueueMonitor implements AdminQueueMonitor {
  constructor(readonly name: AdminQueueName, private readonly queue: BullQueueReader) {}

  async getJobCounts() {
    const counts = await this.queue.getJobCounts();
    return {
      waiting: counts.wait ?? 0,
      active: counts.active ?? 0,
      delayed: counts.delayed ?? 0,
      failed: counts.failed ?? 0,
      completed: counts.completed ?? 0,
    };
  }

  getWorkers() { return this.queue.getWorkers(); }

  async getOldestPendingAt(): Promise<Date | null> {
    const [job] = await this.queue.getJobs(['wait', 'delayed'], 0, 0, true);
    return job ? new Date(job.timestamp) : null;
  }
}
