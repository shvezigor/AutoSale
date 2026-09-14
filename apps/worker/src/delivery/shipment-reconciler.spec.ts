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

  it('groups due Ukrposhta work by tenant connection and generation into batches of at most 50', async () => {
    const tenantA = '11111111-1111-4111-8111-111111111111';
    const tenantB = '22222222-2222-4222-8222-222222222222';
    const rows = Array.from({ length: 52 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      tenantId: index === 51 ? tenantB : tenantA,
      provider: 'UKRPOSHTA', connectionId: index === 51 ? 'connection-b' : 'connection-a',
      version: 2, requestHash: `hash-${index}`,
      providerMetadata: { environment: 'SANDBOX', credentialGenerationId: index === 51 ? 'generation-b' : 'generation-a' },
    }));
    const add = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      shipmentAttempt: { findMany: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]), upsert: vi.fn().mockResolvedValue({}) },
      shipment: { findMany: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(rows) },
    };

    await expect(new ShipmentReconciler(prisma as never, { add }).reconcile()).resolves.toEqual({ attempted: 52, queued: 3 });
    const batchCalls = add.mock.calls.filter(([name]) => name === 'shipment.status.sync.ukrposhta');
    expect(batchCalls.map(([, data]) => data.shipmentIds.length)).toEqual([50, 1, 1]);
    expect(batchCalls.every(([, data]) => new Set(data.shipmentIds).size === data.shipmentIds.length)).toBe(true);
    expect(add).not.toHaveBeenCalledWith('shipment.status.sync', expect.anything(), expect.anything());
  });

  it('keeps the existing non-Ukrposhta reconciliation limit isolated from Ukrposhta batches', async () => {
    const shipmentFindMany = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const prisma = {
      shipmentAttempt: { findMany: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]), upsert: vi.fn() },
      shipment: { findMany: shipmentFindMany },
    };

    await new ShipmentReconciler(prisma as never, { add: vi.fn() }).reconcile();

    expect(shipmentFindMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: expect.objectContaining({ provider: { not: 'UKRPOSHTA' } }), take: 50 }));
    expect(shipmentFindMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: expect.objectContaining({ provider: 'UKRPOSHTA' }), take: 250 }));
  });
});
