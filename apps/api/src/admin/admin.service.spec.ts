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
});
