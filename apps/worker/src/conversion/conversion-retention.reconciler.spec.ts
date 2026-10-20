import { describe, expect, it, vi } from 'vitest';

import { ConversionRetentionReconciler } from './conversion-retention.reconciler.js';

describe('ConversionRetentionReconciler', () => {
  it('uses a bounded batch without exposing tenant identifiers in the result', async () => {
    const now = new Date('2026-10-20T00:00:00Z');
    const purgeDue = vi.fn().mockResolvedValue({ interestsDeleted: 2, countersDeleted: 3 });
    expect(await new ConversionRetentionReconciler({ purgeDue }, () => now).reconcile())
      .toEqual({ interestsDeleted: 2, countersDeleted: 3 });
    expect(purgeDue).toHaveBeenCalledWith(now, 100);
  });
});
