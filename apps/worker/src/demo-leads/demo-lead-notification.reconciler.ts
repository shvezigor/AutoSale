import type { DemoLeadNotificationStore } from '@autosale/database';

interface DemoLeadQueue {
  add(name: 'demo-lead.notify', data: { leadId: string }, options: {
    jobId: string; attempts: 1; removeOnComplete: number; removeOnFail: number;
  }): Promise<unknown>;
}

export class DemoLeadNotificationReconciler {
  constructor(
    private readonly store: Pick<DemoLeadNotificationStore, 'finalizeExpiredLeases' | 'listDue'>,
    private readonly queue: DemoLeadQueue,
    private readonly now: () => Date = () => new Date(),
    private readonly configured = true,
  ) {}

  async reconcile(): Promise<{ attempted: number; enqueued: number; failed: number }> {
    if (!this.configured) return { attempted: 0, enqueued: 0, failed: 0 };
    await this.store.finalizeExpiredLeases();
    const ids = await this.store.listDue(50);
    const bucket = Math.floor(this.now().getTime() / 5_000);
    let enqueued = 0;
    let failed = 0;
    for (const leadId of ids) {
      try {
        await this.queue.add('demo-lead.notify', { leadId }, {
          jobId: `demo-lead-${leadId}-${bucket}`,
          attempts: 1, removeOnComplete: 100, removeOnFail: 250,
        });
        enqueued += 1;
      } catch {
        failed += 1;
      }
    }
    return { attempted: ids.length, enqueued, failed };
  }
}
