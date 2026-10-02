import type { AuthPrincipal } from '@autosale/contracts/auth';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { AUTH_ACCESS_KEY } from '../auth/auth.decorators.js';
import { SearchController } from './search.controller.js';

const principal: AuthPrincipal = {
  userId: 'f46c9029-ecdd-4fa5-8c0a-e3146ffe3168',
  email: 'manager@example.com',
  name: 'Manager',
  platformRole: 'USER',
  tenantId: 'tenant-a',
  membershipRole: 'MANAGER',
};

describe('SearchController', () => {
  it('normalizes input and forwards only the authenticated tenant', async () => {
    const search = vi.fn().mockResolvedValue({ query: 'Олена', customers: [], orders: [], products: [] });
    const controller = new SearchController({ search } as never);

    await expect(controller.search(principal, { q: ' Олена ', limit: '5' })).resolves.toEqual({ query: 'Олена', customers: [], orders: [], products: [] });
    expect(search).toHaveBeenCalledWith('tenant-a', { q: 'Олена', limit: 5 });
  });

  it('returns a safe bad request for invalid queries', async () => {
    const controller = new SearchController({ search: vi.fn() } as never);

    expect(() => controller.search(principal, { q: 'a' })).toThrow(BadRequestException);
    expect(() => controller.search(principal, { q: 'valid', limit: '11' })).toThrow('Invalid workspace search query');
  });

  it('requires manager workspace access', () => {
    expect(Reflect.getMetadata(AUTH_ACCESS_KEY, SearchController)).toBe('TENANT_MANAGER');
  });
});
