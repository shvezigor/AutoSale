import type { PrismaClient } from '@autosale/database';
import { describe, expect, it, vi } from 'vitest';

import { CryptoService } from './crypto.service.js';
import { SessionService } from './session.service.js';

describe('SessionService', () => {
  it('issues, resolves and revokes a session through bounded database authority', async () => {
    const sessionId = '10000000-0000-4000-8000-000000000001';
    const userId = '10000000-0000-4000-8000-000000000002';
    const tenantId = '10000000-0000-4000-8000-000000000003';
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([{ session_id: sessionId }])
      .mockResolvedValueOnce([{
        session_id: sessionId, user_id: userId, tenant_id: tenantId,
        email: 'owner@example.com', display_name: 'Олена', platform_role: 'USER', membership_role: 'OWNER',
        locale: 'en', avatar_storage_key: 'users/avatar.webp', avatar_checksum: 'avatar-checksum',
      }])
      .mockResolvedValueOnce([{ revoked_count: 1 }]);
    const sessions = new SessionService({ $queryRaw: queryRaw } as unknown as PrismaClient, new CryptoService(), 'p'.repeat(32), () => new Date('2026-08-27T12:00:00Z'));

    const issued = await sessions.create(userId, tenantId, { ipPrefix: '127.0.0.0/24', userAgent: 'test' });
    await expect(sessions.resolve(issued.rawToken)).resolves.toMatchObject({
      userId, name: 'Олена', tenantId, membershipRole: 'OWNER', locale: 'en',
      avatarUrl: '/api/media/profile/avatar?v=avatar-checksum',
    });
    await sessions.revoke(sessionId);
    expect(queryRaw).toHaveBeenCalledTimes(3);
  });

  it('returns null when database authority rejects the session', async () => {
    const sessions = new SessionService(
      { $queryRaw: vi.fn().mockResolvedValue([]) } as unknown as PrismaClient,
      new CryptoService(),
      'p'.repeat(32),
    );
    await expect(sessions.resolve('expired-or-blocked')).resolves.toBeNull();
  });

  it('returns a null avatar when the user has no controlled avatar', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{
      session_id: '10000000-0000-4000-8000-000000000001',
      user_id: '10000000-0000-4000-8000-000000000002', tenant_id: null,
      email: 'admin@example.com', display_name: 'Admin', platform_role: 'PLATFORM_ADMIN', membership_role: null,
      locale: 'uk', avatar_storage_key: null, avatar_checksum: null,
    }]);
    const sessions = new SessionService({ $queryRaw: queryRaw } as unknown as PrismaClient, new CryptoService(), 'p'.repeat(32));
    await expect(sessions.resolve('active')).resolves.toMatchObject({ locale: 'uk', avatarUrl: null });
  });

  it('revokes every active session except the current one', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ revoked_count: 2 }]);
    const sessions = new SessionService({ $queryRaw: queryRaw } as unknown as PrismaClient, new CryptoService(), 'p'.repeat(32));
    await expect(sessions.revokeOthersForUser(
      '10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000001',
    )).resolves.toBe(2);
  });
});
