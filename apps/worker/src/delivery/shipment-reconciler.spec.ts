import { describe, expect, it, vi } from 'vitest';

import { ShipmentReconciler } from './shipment-reconciler.js';

describe('ShipmentReconciler', () => {
  it('only wakes durable due work with a deterministic queue id', async () => {
    const now = new Date('2026-09-11T10:00:00.000Z');
    const shipmentId = '11111111-1111-4111-8111-111111111111';
    const findMany = vi.fn().mockResolvedValueOnce([{ shipmentId, version: 2 }]).mockResolvedValueOnce([]);
    const add = vi.fn().mockResolvedValue(undefined);
    await expect(new ShipmentReconciler({ shipmentAttempt: { findMany }, shipment: { findMany: vi.fn().mockResolvedValue([]) } } as never, { add }, () => now).reconcile())
      .resolves.toEqual({ attempted: 1, queued: 1 });
    expect(add).toHaveBeenCalledWith('shipment.create', { shipmentId }, {
      jobId: `shipment:create:${shipmentId}:2`, attempts: 1, removeOnComplete: true, removeOnFail: true,
    });
  });

  it('leaves failed queue wakeups for the next reconciliation pass', async () => {
    const findMany = vi.fn().mockResolvedValueOnce([{ shipmentId: '11111111-1111-4111-8111-111111111111', version: 1 }]).mockResolvedValueOnce([]);
    const add = vi.fn().mockRejectedValue(new Error('redis unavailable'));
    await expect(new ShipmentReconciler({ shipmentAttempt: { findMany }, shipment: { findMany: vi.fn().mockResolvedValue([]) } } as never, { add }).reconcile())
      .resolves.toEqual({ attempted: 1, queued: 0 });
  });
});
