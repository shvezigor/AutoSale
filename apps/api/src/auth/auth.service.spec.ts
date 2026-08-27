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
});
