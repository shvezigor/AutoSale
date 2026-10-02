import { describe, expect, it, vi } from 'vitest';

import { AdminService } from './admin.service.js';

describe('AdminService privacy contract', () => {
  it('returns operational aggregates without customer data', async () => {
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([{
        tenant_id: 'tenant-1', tenant_name: 'Store', tenant_status: 'ACTIVE',
        owner_email: 'owner@example.com', user_count: 2n, created_at: new Date('2026-08-27T00:00:00Z'),
      }])
      .mockResolvedValueOnce([{ tenantId: 'tenant-1', orderCount: 4n }]);
    const service = new AdminService({ $queryRaw: queryRaw } as never);

    const result = await service.listTenants();
    const serialized = JSON.stringify(result);

    expect(result).toEqual([{ tenantId: 'tenant-1', tenantName: 'Store', status: 'ACTIVE', ownerEmail: 'owner@example.com', userCount: 2, orderCount: 4, createdAt: '2026-08-27T00:00:00.000Z' }]);
    expect(queryRaw).toHaveBeenCalledTimes(2);
    for (const forbidden of ['phone', 'address', 'message', 'extraction', 'storageKey']) expect(serialized).not.toContain(forbidden);
  });

  it('blocks a tenant and revokes all of its active sessions', async () => {
    const tenantUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const revokeSessions = vi.fn().mockResolvedValue([{ revoked_count: 3 }]);
    const service = new AdminService({ tenant: { updateMany: tenantUpdateMany }, $queryRaw: revokeSessions } as never, () => new Date('2026-08-27T00:00:00Z'));

    await expect(service.setTenantStatus('tenant-1', 'BLOCKED')).resolves.toEqual({ status: 'BLOCKED', revokedSessions: 3 });
    expect(tenantUpdateMany).toHaveBeenCalledWith({ where: { id: 'tenant-1' }, data: { status: 'BLOCKED' } });
    expect(revokeSessions).toHaveBeenCalledOnce();
  });

  it('builds the platform overview from privacy-safe tenant aggregates', async () => {
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([
        { tenant_id: 'tenant-1', tenant_name: 'One', tenant_status: 'ACTIVE', owner_email: 'one@example.test', user_count: 2n, created_at: new Date('2026-09-20T00:00:00Z') },
        { tenant_id: 'tenant-2', tenant_name: 'Two', tenant_status: 'BLOCKED', owner_email: 'two@example.test', user_count: 1n, created_at: new Date('2026-08-01T00:00:00Z') },
      ])
      .mockResolvedValueOnce([{ tenantId: 'tenant-1', orderCount: 4n }, { tenantId: 'tenant-2', orderCount: 2n }]);
    const queues = [{
      name: 'instagram' as const,
      getJobCounts: vi.fn().mockResolvedValue({ waiting: 1, active: 0, delayed: 0, failed: 2, completed: 8 }),
      getWorkers: vi.fn().mockResolvedValue([{ id: 'worker-1' }]),
      getOldestPendingAt: vi.fn().mockResolvedValue(new Date('2026-10-01T12:00:00Z')),
    }];
    const service = new AdminService({ $queryRaw: queryRaw } as never, () => new Date('2026-10-02T12:00:00Z'), queues);

    await expect(service.getOverview()).resolves.toEqual({
      status: 'DEGRADED', attentionQueueCount: 1, updatedAt: '2026-10-02T12:00:00.000Z',
      metrics: { tenantCount: 2, activeTenantCount: 1, blockedTenantCount: 1, userCount: 3, orderCount: 6, newTenantCount30Days: 1 },
    });
  });

  it('returns safe queue counters and degrades an unavailable monitor without exposing its error', async () => {
    const healthy = {
      name: 'catalogue' as const,
      getJobCounts: vi.fn().mockResolvedValue({ waiting: 0, active: 0, delayed: 0, failed: 0, completed: 3 }),
      getWorkers: vi.fn().mockResolvedValue([]),
      getOldestPendingAt: vi.fn().mockResolvedValue(null),
    };
    const unavailable = {
      name: 'delivery' as const,
      getJobCounts: vi.fn().mockRejectedValue(new Error('redis://secret@internal')),
      getWorkers: vi.fn(),
      getOldestPendingAt: vi.fn(),
    };
    const service = new AdminService({} as never, () => new Date('2026-10-02T12:00:00Z'), [healthy, unavailable]);

    const result = await service.getOperations();

    expect(result).toEqual({
      status: 'DEGRADED', database: 'HEALTHY', updatedAt: '2026-10-02T12:00:00.000Z',
      queues: [
        { queue: 'catalogue', status: 'IDLE', waiting: 0, active: 0, delayed: 0, failed: 0, completed: 3, workerCount: 0, oldestPendingAt: null, available: true },
        { queue: 'delivery', status: 'ATTENTION', waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0, workerCount: 0, oldestPendingAt: null, available: false },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('resolves tenant detail from the same aggregate-only directory', async () => {
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([{ tenant_id: 'tenant-1', tenant_name: 'Store', tenant_status: 'ACTIVE', owner_email: 'owner@example.test', user_count: 2n, created_at: new Date('2026-08-27T00:00:00Z') }])
      .mockResolvedValueOnce([{ tenantId: 'tenant-1', orderCount: 4n }])
      .mockResolvedValueOnce([{ tenant_id: 'tenant-1', tenant_name: 'Store', tenant_status: 'ACTIVE', owner_email: 'owner@example.test', user_count: 2n, created_at: new Date('2026-08-27T00:00:00Z') }])
      .mockResolvedValueOnce([{ tenantId: 'tenant-1', orderCount: 4n }]);
    const service = new AdminService({ $queryRaw: queryRaw } as never);

    await expect(service.getTenant('tenant-1')).resolves.toMatchObject({ tenantId: 'tenant-1', orderCount: 4 });
    await expect(service.getTenant('missing')).resolves.toBeNull();
  });
});
