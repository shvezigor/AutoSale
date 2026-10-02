import { describe, expect, it, vi } from 'vitest';

import { AdminStepUpService } from './admin-step-up.service.js';

const userId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-10-02T09:00:00.000Z');

describe('AdminStepUpService', () => {
  it('rejects a wrong password without issuing a token', async () => {
    const crypto = { verifyPassword: vi.fn().mockResolvedValue(false) };
    const prisma = { user: { findUnique: vi.fn().mockResolvedValue({
      passwordHash: 'fictional-hash', platformRole: 'PLATFORM_ADMIN', status: 'ACTIVE',
    }) } };
    const service = new AdminStepUpService(prisma as never, crypto as never, 'p'.repeat(32), () => now);

    await expect(service.issue(userId, sessionId, 'wrong password', 'TENANT_DELETE_REQUEST'))
      .rejects.toThrow('ADMIN_REAUTH_FAILED');
  });

  it('rejects passwordless administrators with a safe error code', async () => {
    const prisma = { user: { findUnique: vi.fn().mockResolvedValue({
      passwordHash: null, platformRole: 'PLATFORM_ADMIN', status: 'ACTIVE',
    }) } };
    const service = new AdminStepUpService(prisma as never, { verifyPassword: vi.fn() } as never, 'p'.repeat(32), () => now);

    await expect(service.issue(userId, sessionId, 'unused', 'TENANT_DELETE_REQUEST'))
      .rejects.toThrow('ADMIN_REAUTH_UNAVAILABLE');
  });

  it('binds a five-minute token to user, session and purpose', async () => {
    const crypto = { verifyPassword: vi.fn().mockResolvedValue(true) };
    const prisma = { user: { findUnique: vi.fn().mockResolvedValue({
      passwordHash: 'fictional-hash', platformRole: 'PLATFORM_ADMIN', status: 'ACTIVE',
    }) } };
    let clock = now;
    const service = new AdminStepUpService(prisma as never, crypto as never, 'p'.repeat(32), () => clock);

    const token = await service.issue(userId, sessionId, 'fictional secure password', 'TENANT_DELETE_REQUEST');

    expect(service.verify(token, userId, sessionId, 'TENANT_DELETE_REQUEST')).toBe(true);
    expect(service.verify(token, userId, 'different-session', 'TENANT_DELETE_REQUEST')).toBe(false);
    clock = new Date(now.getTime() + 5 * 60_000 + 1);
    expect(service.verify(token, userId, sessionId, 'TENANT_DELETE_REQUEST')).toBe(false);
  });
});
