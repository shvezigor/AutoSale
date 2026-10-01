import { describe, expect, it, vi } from 'vitest';

vi.mock('@autosale/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@autosale/database')>()),
  withTenantTransaction: async <T>(prisma: unknown, _tenantId: string, operation: (transaction: unknown) => Promise<T>) => operation(prisma),
}));

import { ShipmentReconciler } from './shipment-reconciler.js';

const tenantA = '11111111-1111-4111-8111-111111111111';

describe('ShipmentReconciler', () => {
  it('only wakes durable due work with a deterministic queue id', async () => {
    const now = new Date('2026-09-11T10:00:00.000Z');
    const shipmentId = '22222222-2222-4222-8222-222222222222';
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([{ tenant_id: tenantA, shipment_id: shipmentId, version: 2 }])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const add = vi.fn().mockResolvedValue(undefined);
    await expect(new ShipmentReconciler({ $queryRaw: queryRaw } as never, { add }, () => now).reconcile())
      .resolves.toEqual({ attempted: 1, queued: 1 });
    expect(add).toHaveBeenCalledWith('shipment.create', { shipmentId }, {
      jobId: `shipment:create:${shipmentId}:2`, attempts: 1, removeOnComplete: true, removeOnFail: true,
    });
  });

  it('leaves failed queue wakeups for the next reconciliation pass', async () => {
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([{ tenant_id: tenantA, shipment_id: '22222222-2222-4222-8222-222222222222', version: 1 }])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const add = vi.fn().mockRejectedValue(new Error('redis unavailable'));
    await expect(new ShipmentReconciler({ $queryRaw: queryRaw } as never, { add }).reconcile())
      .resolves.toEqual({ attempted: 1, queued: 0 });
  });

  it('groups due Ukrposhta work by tenant connection and generation into batches of at most 50', async () => {
    const tenantB = '33333333-3333-4333-8333-333333333333';
    const rows = Array.from({ length: 52 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      tenantId: index === 51 ? tenantB : tenantA,
      provider: 'UKRPOSHTA' as const, connectionId: index === 51 ? 'connection-b' : 'connection-a',
      version: 2, requestHash: `hash-${index}`,
      providerMetadata: { environment: 'SANDBOX', credentialGenerationId: index === 51 ? 'generation-b' : 'generation-a' },
    }));
    const dueRows = rows.map((row) => ({ tenant_id: row.tenantId, shipment_id: row.id, version: row.version }));
    const byId = new Map(rows.map((row) => [row.id, row]));
    const add = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce(dueRows).mockResolvedValueOnce([]),
      shipmentAttempt: { upsert: vi.fn().mockResolvedValue({}) },
      shipment: { findFirst: vi.fn().mockImplementation(async ({ where }) => byId.get(where.id) ?? null) },
    };

    await expect(new ShipmentReconciler(prisma as never, { add }).reconcile()).resolves.toEqual({ attempted: 52, queued: 3 });
    const batchCalls = add.mock.calls.filter(([name]) => name === 'shipment.status.sync.ukrposhta');
    expect(batchCalls.map(([, data]) => data.shipmentIds.length)).toEqual([50, 1, 1]);
    expect(batchCalls.every(([, data]) => new Set(data.shipmentIds).size === data.shipmentIds.length)).toBe(true);
    expect(add).not.toHaveBeenCalledWith('shipment.status.sync', expect.anything(), expect.anything());
  });

  it('keeps standard and Ukrposhta discovery limits explicit at the authority boundary', async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    await new ShipmentReconciler({ $queryRaw: queryRaw } as never, { add: vi.fn() }).reconcile();

    expect(queryRaw.mock.calls).toHaveLength(4);
    expect(queryRaw.mock.calls[1]?.slice(1)).toEqual([expect.any(Date), 'STANDARD', 50]);
    expect(queryRaw.mock.calls[2]?.slice(1)).toEqual([expect.any(Date), 'UKRPOSHTA', 250]);
  });
});
