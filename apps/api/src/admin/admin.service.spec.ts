import { describe, expect, it, vi } from 'vitest';

import { AdminService } from './admin.service.js';

describe('AdminService privacy contract', () => {
  it('returns operational aggregates without customer data', async () => {
    const findMany = vi.fn().mockResolvedValue([{
      id: 'tenant-1', name: 'Store', status: 'ACTIVE', createdAt: new Date('2026-08-27T00:00:00Z'),
      memberships: [{ user: { email: 'owner@example.com' } }],
      _count: { memberships: 2, orders: 4 },
    }]);
    const service = new AdminService({ tenant: { findMany } } as never);

    const result = await service.listTenants();
    const serialized = JSON.stringify(result);

    expect(result).toEqual([{ tenantId: 'tenant-1', tenantName: 'Store', status: 'ACTIVE', ownerEmail: 'owner@example.com', userCount: 2, orderCount: 4, createdAt: '2026-08-27T00:00:00.000Z' }]);
    for (const forbidden of ['phone', 'address', 'message', 'extraction', 'storageKey']) expect(serialized).not.toContain(forbidden);
  });

  it('blocks a tenant and revokes all of its active sessions', async () => {
    const tenantUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const sessionUpdateMany = vi.fn().mockResolvedValue({ count: 3 });
    const service = new AdminService({ tenant: { updateMany: tenantUpdateMany }, session: { updateMany: sessionUpdateMany } } as never, () => new Date('2026-08-27T00:00:00Z'));

    await expect(service.setTenantStatus('tenant-1', 'BLOCKED')).resolves.toEqual({ status: 'BLOCKED', revokedSessions: 3 });
    expect(tenantUpdateMany).toHaveBeenCalledWith({ where: { id: 'tenant-1' }, data: { status: 'BLOCKED' } });
    expect(sessionUpdateMany).toHaveBeenCalledWith({ where: { tenantId: 'tenant-1', revokedAt: null }, data: { revokedAt: new Date('2026-08-27T00:00:00Z') } });
  });
});
