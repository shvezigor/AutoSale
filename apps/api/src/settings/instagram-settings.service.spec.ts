import type { PrismaClient } from '@autosale/database';
import { describe, expect, it, vi } from 'vitest';
import { InstagramSettingsService } from './instagram-settings.service.js';

describe('InstagramSettingsService', () => {
  it('upserts a connection only for the authenticated tenant', async () => {
    const upsert = vi.fn(async () => ({ externalAccountId: '17841400000000000', displayName: 'Store', status: 'ACTIVE', updatedAt: new Date('2026-08-27T00:00:00Z') }));
    const service = new InstagramSettingsService({ instagramConnection: { upsert } } as unknown as PrismaClient);
    await service.update('tenant-a', { externalAccountId: '17841400000000000', displayName: 'Store' });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant-a' }, create: expect.objectContaining({ tenantId: 'tenant-a' }) }));
  });
});
