import type { ConversionRetentionStore } from '@autosale/database';

export class ConversionRetentionReconciler {
  constructor(private readonly store: Pick<ConversionRetentionStore, 'purgeDue'>, private readonly now: () => Date = () => new Date()) {}

  reconcile(): Promise<{ interestsDeleted: number; countersDeleted: number }> {
    return this.store.purgeDue(this.now(), 100);
  }
}
