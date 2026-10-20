import type { DemoLeadRetentionStore } from '@autosale/database';

export class DemoLeadRetentionReconciler {
  constructor(
    private readonly store: Pick<DemoLeadRetentionStore, 'purgeDue'>,
    private readonly enabled: boolean,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async reconcile(): Promise<{ purged: number; busy: number }> {
    if (!this.enabled) return { purged: 0, busy: 0 };
    return this.store.purgeDue(this.now(), 100);
  }
}
