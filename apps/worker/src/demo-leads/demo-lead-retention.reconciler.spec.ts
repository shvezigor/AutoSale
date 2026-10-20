import { describe, expect, it, vi } from 'vitest';

import { DemoLeadRetentionReconciler } from './demo-lead-retention.reconciler.js';

const now = new Date('2027-04-18T00:00:00.000Z');

describe('DemoLeadRetentionReconciler', () => {
  it('does not purge anything by default before the backup and erasure-replay gate', async () => {
    const purgeDue = vi.fn();
    const reconciler = new DemoLeadRetentionReconciler({ purgeDue } as never, false, () => now);
    await expect(reconciler.reconcile()).resolves.toEqual({ purged: 0, busy: 0 });
    expect(purgeDue).not.toHaveBeenCalled();
  });

  it('uses a bounded database sweep only after explicit enablement', async () => {
    const purgeDue = vi.fn().mockResolvedValue({ purged: 2, busy: 1 });
    const reconciler = new DemoLeadRetentionReconciler({ purgeDue } as never, true, () => now);
    await expect(reconciler.reconcile()).resolves.toEqual({ purged: 2, busy: 1 });
    expect(purgeDue).toHaveBeenCalledWith(now, 100);
  });
});
