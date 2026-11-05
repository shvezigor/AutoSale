import type { PrismaClient } from '@autosale/database';
import { describe, expect, it, vi } from 'vitest';

import { AuthService } from './auth.service.js';
import { CryptoService } from './crypto.service.js';
import type { EmailDelivery } from './email-delivery.js';

describe('AuthService', () => {
  it('does not reactivate a user with a stale verification token', async () => {
    const activateMemberships = vi.fn();
    const markUsed = vi.fn();
    const tx = {
      emailVerificationToken: {
        findUnique: vi.fn().mockResolvedValue({ id: 'token-1', userId: 'user-1', usedAt: null, expiresAt: new Date('2026-08-28T00:00:00Z') }),
        update: markUsed,
      },
      user: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      $queryRaw: activateMemberships,
    };
    const prisma = { $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)) } as unknown as PrismaClient;
    const auth = new AuthService(prisma, { hashOpaqueToken: vi.fn().mockReturnValue('hash') } as never, {} as never,
      {} as never, 't'.repeat(32), 'http://localhost', () => new Date('2026-08-27T00:00:00Z'));

    await expect(auth.verifyEmail('fictional-token')).rejects.toThrow('Invalid or expired token');
    expect(tx.user.updateMany).toHaveBeenCalledWith({ where: { id: 'user-1', status: 'PENDING' }, data: { status: 'ACTIVE', emailVerifiedAt: new Date('2026-08-27T00:00:00Z') } });
    expect(activateMemberships).not.toHaveBeenCalled();
    expect(markUsed).not.toHaveBeenCalled();
  });

  it('does not reset a password for a user who is no longer active', async () => {
    const markUsed = vi.fn();
    const tx = {
      passwordResetToken: {
        findUnique: vi.fn().mockResolvedValue({ id: 'reset-1', userId: 'user-1', usedAt: null, expiresAt: new Date('2026-08-28T00:00:00Z') }),
        update: markUsed,
      },
      user: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const prisma = { $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)) } as unknown as PrismaClient;
    const revokeAllForUser = vi.fn();
    const auth = new AuthService(prisma, {
      hashOpaqueToken: vi.fn().mockReturnValue('hash'), hashPassword: vi.fn().mockResolvedValue('fictional-hash'),
    } as never, { revokeAllForUser } as never, {} as never,
    't'.repeat(32), 'http://localhost', () => new Date('2026-08-27T00:00:00Z'));

    await expect(auth.resetPassword('fictional-token', 'fictional-long-password')).rejects.toThrow('Invalid or expired token');
    expect(tx.user.updateMany).toHaveBeenCalledWith({ where: { id: 'user-1', status: 'ACTIVE' }, data: { passwordHash: 'fictional-hash' } });
    expect(markUsed).not.toHaveBeenCalled();
    expect(revokeAllForUser).not.toHaveBeenCalled();
  });

  it('registers a pending owner and sends a verification URL without persisting its raw token', async () => {
    const createdToken: { tokenHash?: string } = {};
    const tx = {
      tenant: { create: vi.fn(async () => ({ id: '10000000-0000-4000-8000-000000000001' })), update: vi.fn(async () => ({})) },
      user: { create: vi.fn(async () => ({ id: '10000000-0000-4000-8000-000000000002', email: 'owner@example.com' })) },
      tenantMembership: { create: vi.fn(async () => ({})) },
      emailVerificationToken: { create: vi.fn(async ({ data }: { data: { tokenHash: string } }) => { createdToken.tokenHash = data.tokenHash; return {}; }) },
      $queryRaw: vi.fn(async () => []),
    };
    const prisma = { $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) } as unknown as PrismaClient;
    const email: EmailDelivery = { sendVerification: vi.fn(async () => undefined), sendPasswordReset: vi.fn(async () => undefined), sendInvitation: vi.fn(async () => undefined) };
    const auth = new AuthService(prisma, new CryptoService(), {} as never, email, 't'.repeat(32), 'http://localhost', () => new Date('2026-08-27T12:00:00Z'));

    const result = await auth.register({ email: ' Owner@Example.com ', password: 'correct horse battery', name: 'Owner', tenantName: 'Store' }, {});

    expect(tx.user.create).toHaveBeenCalledWith({ data: expect.objectContaining({ email: 'owner@example.com', status: 'PENDING' }) });
    expect(tx.tenant.update).toHaveBeenCalledWith({ where: { id: '10000000-0000-4000-8000-000000000001' }, data: { createdByUserId: '10000000-0000-4000-8000-000000000002' } });
    expect(tx.tenantMembership.create).toHaveBeenCalledWith({ data: expect.objectContaining({ role: 'OWNER', status: 'PENDING' }) });
    const sentUrl = vi.mocked(email.sendVerification).mock.calls[0]![1];
    expect(sentUrl).toContain('/verify-email?token=');
    expect(sentUrl).not.toContain(createdToken.tokenHash!);
    expect(result).toEqual({ accepted: true });
  });

  it('returns a neutral response when password reset email is unknown', async () => {
    const prisma = { user: { findUnique: vi.fn(async () => null) } } as unknown as PrismaClient;
    const email: EmailDelivery = { sendVerification: vi.fn(), sendPasswordReset: vi.fn(), sendInvitation: vi.fn() };
    const auth = new AuthService(prisma, new CryptoService(), {} as never, email, 't'.repeat(32), 'http://localhost');
    await expect(auth.requestPasswordReset('missing@example.com')).resolves.toEqual({ accepted: true });
    expect(email.sendPasswordReset).not.toHaveBeenCalled();
  });

  it('rejects password login for a Google-only account without attempting password verification', async () => {
    const update = vi.fn();
    const prisma = { user: { findUnique: vi.fn(async () => ({
      id: '10000000-0000-4000-8000-000000000002', email: 'owner@example.com', name: 'Owner',
      passwordHash: null, status: 'ACTIVE', emailVerifiedAt: new Date(), platformRole: 'USER', memberships: [],
    })), update } } as unknown as PrismaClient;
    const crypto = new CryptoService();
    const verifyPassword = vi.spyOn(crypto, 'verifyPassword');
    const email: EmailDelivery = { sendVerification: vi.fn(), sendPasswordReset: vi.fn(), sendInvitation: vi.fn() };
    const auth = new AuthService(prisma, crypto, {} as never, email, 't'.repeat(32), 'http://localhost');

    await expect(auth.login({ email: 'owner@example.com', password: 'correct horse battery' }, {}))
      .rejects.toThrow('Invalid credentials');
    expect(verifyPassword).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('records a successful password login and returns profile session fields', async () => {
    const loggedInAt = new Date('2026-09-14T15:00:00.000Z');
    const user = {
      id: '10000000-0000-4000-8000-000000000002',
      email: 'owner@example.com',
      name: 'Owner',
      passwordHash: 'stored-hash',
      status: 'ACTIVE',
      emailVerifiedAt: new Date('2026-09-01T00:00:00.000Z'),
      platformRole: 'USER',
      locale: 'en',
      avatarStorageKey: 'users/avatar.webp',
      avatarChecksum: 'avatar-v2',
      memberships: [{ tenantId: 'tenant-1', role: 'OWNER', status: 'ACTIVE' }],
    } as const;
    const update = vi.fn(async () => user);
    const prisma = {
      user: { findUnique: vi.fn(async () => user), update },
      $queryRaw: vi.fn(async () => [{ tenant_id: 'tenant-1', membership_role: 'OWNER' }]),
    } as unknown as PrismaClient;
    const crypto = { verifyPassword: vi.fn(async () => true) };
    const sessions = { create: vi.fn(async () => ({
      rawToken: 'raw-session',
      expiresAt: new Date('2026-10-14T15:00:00.000Z'),
    })) };
    const email: EmailDelivery = { sendVerification: vi.fn(), sendPasswordReset: vi.fn(), sendInvitation: vi.fn() };
    const auth = new AuthService(
      prisma,
      crypto as never,
      sessions as never,
      email,
      't'.repeat(32),
      'http://localhost',
      () => loggedInAt,
    );

    const result = await auth.login({ email: user.email, password: 'correct horse battery' }, {});

    expect(update).toHaveBeenCalledWith({ where: { id: user.id }, data: { lastLoginAt: loggedInAt } });
    expect(result.session).toMatchObject({
      locale: 'en',
      avatarUrl: '/api/media/profile/avatar?v=avatar-v2',
    });
  });

  it('rejects a regular user when no active tenant membership exists', async () => {
    const user = {
      id: '10000000-0000-4000-8000-000000000002', email: 'owner@example.com', name: 'Owner',
      passwordHash: 'stored-hash', status: 'ACTIVE', emailVerifiedAt: new Date(), platformRole: 'USER',
      locale: 'uk', avatarStorageKey: null, avatarChecksum: null,
    };
    const sessions = { create: vi.fn() };
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue(user) },
      $queryRaw: vi.fn().mockResolvedValue([]),
    } as unknown as PrismaClient;
    const auth = new AuthService(
      prisma, { verifyPassword: vi.fn().mockResolvedValue(true) } as never, sessions as never,
      { sendVerification: vi.fn(), sendPasswordReset: vi.fn(), sendInvitation: vi.fn() },
      't'.repeat(32), 'http://localhost',
    );

    await expect(auth.login({ email: user.email, password: 'correct horse battery' }, {}))
      .rejects.toThrow('Invalid credentials');
    expect(sessions.create).not.toHaveBeenCalled();
  });
});
