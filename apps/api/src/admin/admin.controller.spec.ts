import { describe, expect, it, vi } from 'vitest';

import { AdminController } from './admin.controller.js';

describe('AdminController', () => {
  it('exposes aggregate tenants and tenant status controls only', async () => {
    const service = { listTenants: vi.fn().mockResolvedValue([]), setTenantStatus: vi.fn().mockResolvedValue({ status: 'BLOCKED', revokedSessions: 2 }) };
    const controller = new AdminController(service as never);

    await expect(controller.listTenants()).resolves.toEqual([]);
    await expect(controller.blockTenant('tenant-1')).resolves.toEqual({ status: 'BLOCKED', revokedSessions: 2 });
    expect(service.setTenantStatus).toHaveBeenCalledWith('tenant-1', 'BLOCKED');
  });
});
