import { describe, expect, it, vi } from 'vitest';

import { activateOwnerMemberships, activeMembershipForUser } from './membership-authority.js';

describe('membership authority', () => {
  it('returns the bounded active membership selected by the database', async () => {
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([{ tenant_id: 'tenant-1', membership_role: 'OWNER' }]) };
    await expect(activeMembershipForUser(prisma as never, 'user-1')).resolves.toEqual({ tenantId: 'tenant-1', role: 'OWNER' });
  });

  it('activates pending owner memberships without reading other tenants', async () => {
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([{ activated_count: 1 }]) };
    await expect(activateOwnerMemberships(prisma as never, 'user-1')).resolves.toBe(1);
  });
});
