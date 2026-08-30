import type { PrismaClient } from '@autosale/database';
import { describe, expect, it, vi } from 'vitest';
import { InstagramSettingsService } from './instagram-settings.service.js';

describe('InstagramSettingsService', () => {
  it('returns only safe connection metadata for the requested tenant', async () => {
    const findUnique = vi.fn(async () => ({
      externalAccountId: '17841400000000000',
      displayName: 'Store',
      status: 'ACTIVE',
      encryptedAccessToken: 'must-not-leak',
      tokenExpiresAt: new Date('2026-10-27T00:00:00Z'),
      lastVerifiedAt: new Date('2026-08-27T00:00:00Z'),
      lastErrorCode: null,
    }));
    const findMany = vi.fn(async () => []);
    const service = new InstagramSettingsService({
      instagramConnection: { findUnique },
      instagramCredentialCleanup: { findMany },
    } as unknown as PrismaClient);

    const summary = await service.get('tenant-a');

    expect(summary).toEqual({
      status: 'ACTIVE',
      accountId: '17841400000000000',
      username: 'Store',
      tokenExpiresAt: '2026-10-27T00:00:00.000Z',
      lastVerifiedAt: '2026-08-27T00:00:00.000Z',
      lastErrorCode: null,
      cleanupStatus: 'NONE',
      cleanupErrorCode: null,
      cleanupAbandonEligible: false,
    });
    expect(summary).not.toHaveProperty('encryptedAccessToken');
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant-a' } }));
  });

  it('returns cleanup state separately from current connection errors', async () => {
    const service = new InstagramSettingsService({
      instagramConnection: {
        findUnique: vi.fn(async () => ({
          externalAccountId: '17841499999999999',
          displayName: 'New Store',
          status: 'ACTIVE',
          tokenExpiresAt: null,
          lastVerifiedAt: null,
          lastErrorCode: null,
        })),
      },
      instagramCredentialCleanup: {
        findMany: vi.fn(async () => [{
          unsubscribeStatus: 'SUCCEEDED',
          revokeStatus: 'FAILED',
          lastErrorCode: 'META_DISCONNECT_CLEANUP_FAILED',
          attempts: 3,
          leaseId: null,
          leaseExpiresAt: null,
        }]),
      },
    } as unknown as PrismaClient);

    await expect(service.get('tenant-a')).resolves.toMatchObject({
      status: 'ACTIVE',
      accountId: '17841499999999999',
      cleanupStatus: 'FAILED',
      cleanupErrorCode: 'META_DISCONNECT_CLEANUP_FAILED',
      cleanupAbandonEligible: true,
      lastErrorCode: null,
    });
  });
});
