import type { PrismaClient } from '@autosale/database';
import { describe, expect, it, vi } from 'vitest';

import { AuthService } from './auth.service.js';
import { CryptoService } from './crypto.service.js';
import type { EmailDelivery } from './email-delivery.js';

describe('AuthService', () => {
  it('registers a pending owner and sends a verification URL without persisting its raw token', async () => {
    const createdToken: { tokenHash?: string } = {};
    const tx = {
      tenant: { create: vi.fn(async () => ({ id: '10000000-0000-4000-8000-000000000001' })) },
      user: { create: vi.fn(async () => ({ id: '10000000-0000-4000-8000-000000000002', email: 'owner@example.com' })) },
      tenantMembership: { create: vi.fn(async () => ({})) },
      emailVerificationToken: { create: vi.fn(async ({ data }: { data: { tokenHash: string } }) => { createdToken.tokenHash = data.tokenHash; return {}; }) },
    };
    const prisma = { $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) } as unknown as PrismaClient;
    const email: EmailDelivery = { sendVerification: vi.fn(async () => undefined), sendPasswordReset: vi.fn(async () => undefined), sendInvitation: vi.fn(async () => undefined) };
    const auth = new AuthService(prisma, new CryptoService(), {} as never, email, 't'.repeat(32), 'http://localhost', () => new Date('2026-08-27T12:00:00Z'));

    const result = await auth.register({ email: ' Owner@Example.com ', password: 'correct horse battery', name: 'Owner', tenantName: 'Store' }, {});

    expect(tx.user.create).toHaveBeenCalledWith({ data: expect.objectContaining({ email: 'owner@example.com', status: 'PENDING' }) });
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
    const prisma = { user: { findUnique: vi.fn(async () => user), update } } as unknown as PrismaClient;
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
});
