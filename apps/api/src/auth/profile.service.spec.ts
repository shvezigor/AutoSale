import type { AuthPrincipal } from '@autosale/contracts/auth';
import { describe, expect, it, vi } from 'vitest';

import { ProfileService } from './profile.service.js';

const principal: AuthPrincipal = {
  userId: '10000000-0000-4000-8000-000000000001',
  sessionId: 'session-current',
  tenantId: '20000000-0000-4000-8000-000000000002',
  email: 'owner@example.com',
  name: 'Ігор',
  locale: 'uk',
  avatarUrl: null,
  platformRole: 'USER',
  membershipRole: 'OWNER',
};

const storedUser = {
  id: principal.userId,
  email: principal.email,
  name: 'Ігор Швець',
  phone: '+380671234567' as string | null,
  locale: 'uk',
  passwordHash: 'password-hash',
  avatarStorageKey: 'users/private/avatar.webp',
  avatarChecksum: 'checksum-1',
  avatarContentType: 'image/webp',
  createdAt: new Date('2026-09-01T10:00:00.000Z'),
  lastLoginAt: new Date('2026-09-14T12:00:00.000Z'),
  googleIdentity: { id: 'google-identity' },
  memberships: [{ role: 'OWNER', status: 'ACTIVE', tenantId: principal.tenantId }],
};

function createFixture() {
  const prisma = {
    user: {
      findUnique: vi.fn(async () => storedUser),
      update: vi.fn(async (_input?: unknown) => storedUser),
    },
    securityAuditLog: { create: vi.fn(async () => ({})) },
    userAvatarCleanup: { create: vi.fn(async () => ({})) },
    session: { updateMany: vi.fn(async () => ({ count: 0 })) },
    $transaction: vi.fn(async (work: (tx: unknown) => unknown) => work(prisma)),
  };
  const crypto = { verifyPassword: vi.fn(), hashPassword: vi.fn() };
  const sessions = { revokeOthersForUser: vi.fn() };
  const storage = { put: vi.fn(), get: vi.fn(), delete: vi.fn() };
  const service = new ProfileService(prisma as never, crypto as never, sessions as never, storage as never);
  return { prisma, crypto, sessions, storage, service };
}

describe('ProfileService', () => {
  it('reads only the current user and returns a safe public profile', async () => {
    const fixture = createFixture();

    const result = await fixture.service.get(principal);

    expect(fixture.prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: principal.userId },
    }));
    expect(result).toEqual({
      userId: principal.userId,
      email: principal.email,
      name: 'Ігор Швець',
      phone: '+380671234567',
      locale: 'uk',
      avatarUrl: '/api/media/profile/avatar?v=checksum-1',
      membershipRole: 'OWNER',
      signInMethods: ['PASSWORD', 'GOOGLE'],
      canChangePassword: true,
      createdAt: '2026-09-01T10:00:00.000Z',
      lastLoginAt: '2026-09-14T12:00:00.000Z',
    });
    expect(JSON.stringify(result)).not.toContain('password-hash');
    expect(JSON.stringify(result)).not.toContain('users/private/avatar.webp');
  });

  it('updates only editable fields and writes a privacy-safe audit event', async () => {
    const fixture = createFixture();
    fixture.prisma.user.update.mockImplementation(async (input?: unknown) => ({
      ...storedUser,
      ...(input as { data?: Record<string, unknown> } | undefined)?.data,
      name: 'Ігор Новий',
      phone: null,
      locale: 'en',
    }));

    const result = await fixture.service.update(principal, {
      name: 'Ігор Новий',
      phone: null,
      locale: 'en',
    });

    expect(fixture.prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: principal.userId },
      data: { name: 'Ігор Новий', phone: null, locale: 'en' },
    }));
    expect(result).toMatchObject({ name: 'Ігор Новий', phone: null, locale: 'en' });
    expect(fixture.prisma.securityAuditLog.create).toHaveBeenCalledWith({ data: {
      userId: principal.userId,
      tenantId: principal.tenantId,
      actor: 'USER',
      action: 'PROFILE_UPDATED',
      result: 'SUCCESS',
      metadata: { fields: ['locale', 'name', 'phone'] },
    } });
    const auditCall = fixture.prisma.securityAuditLog.create.mock.calls[0];
    expect(JSON.stringify(auditCall)).not.toContain('Ігор Новий');
    expect(JSON.stringify(auditCall)).not.toContain('+380');
  });

  const passwordInput = {
    currentPassword: 'old password value',
    newPassword: 'new password value',
    confirmation: 'new password value',
  };

  it('rejects password changes for a Google-only user', async () => {
    const fixture = createFixture();
    fixture.prisma.user.findUnique.mockResolvedValue({ passwordHash: null } as never);

    await expect(fixture.service.changePassword(principal, passwordInput))
      .rejects.toThrow('PROFILE_PASSWORD_UNAVAILABLE');

    expect(fixture.crypto.hashPassword).not.toHaveBeenCalled();
    expect(fixture.prisma.user.update).not.toHaveBeenCalled();
    expect(fixture.sessions.revokeOthersForUser).not.toHaveBeenCalled();
    expect(fixture.prisma.securityAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: 'PROFILE_PASSWORD_CHANGE_REJECTED',
      result: 'FAILURE',
      metadata: { reason: 'NO_LOCAL_PASSWORD' },
    }) });
    expect(JSON.stringify(fixture.prisma.securityAuditLog.create.mock.calls)).not.toContain(passwordInput.currentPassword);
  });

  it('rejects an incorrect current password without changing sessions', async () => {
    const fixture = createFixture();
    fixture.prisma.user.findUnique.mockResolvedValue({ passwordHash: 'stored-hash' } as never);
    fixture.crypto.verifyPassword.mockResolvedValue(false);

    await expect(fixture.service.changePassword(principal, passwordInput))
      .rejects.toThrow('PROFILE_CURRENT_PASSWORD_INVALID');

    expect(fixture.crypto.hashPassword).not.toHaveBeenCalled();
    expect(fixture.sessions.revokeOthersForUser).not.toHaveBeenCalled();
    expect(fixture.prisma.securityAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      metadata: { reason: 'CURRENT_PASSWORD_INVALID' },
    }) });
  });

  it('changes a local password and revokes only other sessions', async () => {
    const fixture = createFixture();
    fixture.prisma.user.findUnique.mockResolvedValue({ passwordHash: 'stored-hash' } as never);
    fixture.crypto.verifyPassword.mockResolvedValue(true);
    fixture.crypto.hashPassword.mockResolvedValue('replacement-hash');
    fixture.sessions.revokeOthersForUser.mockResolvedValue(2);

    await expect(fixture.service.changePassword(principal, passwordInput))
      .resolves.toEqual({ changed: true, revokedSessions: 2 });

    expect(fixture.prisma.user.update).toHaveBeenCalledWith({
      where: { id: principal.userId },
      data: { passwordHash: 'replacement-hash' },
    });
    expect(fixture.sessions.revokeOthersForUser).toHaveBeenCalledWith(principal.userId, principal.sessionId);
    expect(fixture.prisma.securityAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: 'PROFILE_PASSWORD_CHANGED',
      result: 'SUCCESS',
      metadata: { revokedSessions: 2 },
    }) });
  });

  it('does not revoke sessions when the password update fails', async () => {
    const fixture = createFixture();
    fixture.prisma.user.findUnique.mockResolvedValue({ passwordHash: 'stored-hash' } as never);
    fixture.crypto.verifyPassword.mockResolvedValue(true);
    fixture.crypto.hashPassword.mockResolvedValue('replacement-hash');
    fixture.prisma.user.update.mockRejectedValue(new Error('database unavailable'));

    await expect(fixture.service.changePassword(principal, passwordInput)).rejects.toThrow('database unavailable');
    expect(fixture.sessions.revokeOthersForUser).not.toHaveBeenCalled();
  });
});
