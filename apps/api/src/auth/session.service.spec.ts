import type { PrismaClient } from '@autosale/database';
import { describe, expect, it, vi } from 'vitest';

import { CryptoService } from './crypto.service.js';
import { SessionService } from './session.service.js';

describe('SessionService', () => {
  it('creates, resolves and revokes a session', async () => {
    const record = {
      id: '10000000-0000-4000-8000-000000000001',
      userId: '10000000-0000-4000-8000-000000000002',
      tenantId: '10000000-0000-4000-8000-000000000003',
      tokenHash: '', expiresAt: new Date('2026-09-01T00:00:00Z'),
      lastSeenAt: new Date('2026-08-27T00:00:00Z'), revokedAt: null,
      tenant: { status: 'ACTIVE' },
      user: {
        email: 'owner@example.com', name: 'Олена', platformRole: 'USER', status: 'ACTIVE',
        memberships: [{ tenantId: '10000000-0000-4000-8000-000000000003', role: 'OWNER', status: 'ACTIVE' }],
      },
    };
    const prisma = {
      session: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...record, tokenHash: data.tokenHash })),
        findUnique: vi.fn(async () => record),
        update: vi.fn(async () => record),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    } as unknown as PrismaClient;
    const sessions = new SessionService(prisma, new CryptoService(), 'p'.repeat(32), () => new Date('2026-08-27T12:00:00Z'));

    const issued = await sessions.create(record.userId, record.tenantId, { ipPrefix: '127.0.0.0/24', userAgent: 'test' });
    record.tokenHash = issued.tokenHash;
    await expect(sessions.resolve(issued.rawToken)).resolves.toMatchObject({
      userId: record.userId, name: 'Олена', tenantId: record.tenantId, membershipRole: 'OWNER',
    });
    await sessions.revoke(record.id);
    expect(prisma.session.update).toHaveBeenCalled();
  });

  it('rejects expired or blocked sessions', async () => {
    const prisma = { session: { findUnique: vi.fn(async () => ({
      id: 'session', userId: 'user', tenantId: null, revokedAt: null,
      expiresAt: new Date('2026-08-01T00:00:00Z'), lastSeenAt: new Date(),
      user: { email: 'x@example.com', name: 'X', platformRole: 'USER', status: 'ACTIVE', memberships: [] },
    })) } } as unknown as PrismaClient;
    const sessions = new SessionService(prisma, new CryptoService(), 'p'.repeat(32), () => new Date('2026-08-27T12:00:00Z'));
    await expect(sessions.resolve('expired')).resolves.toBeNull();
  });

  it('rejects sessions for a blocked tenant', async () => {
    const prisma = { session: { findUnique: vi.fn(async () => ({
      id: 'session', userId: 'user', tenantId: 'tenant', revokedAt: null,
      expiresAt: new Date('2026-09-01T00:00:00Z'), lastSeenAt: new Date(), tenant: { status: 'BLOCKED' },
      user: { email: 'x@example.com', name: 'X', platformRole: 'USER', status: 'ACTIVE', memberships: [{ tenantId: 'tenant', role: 'OWNER', status: 'ACTIVE' }] },
    })) } } as unknown as PrismaClient;
    const sessions = new SessionService(prisma, new CryptoService(), 'p'.repeat(32), () => new Date('2026-08-27T12:00:00Z'));

    await expect(sessions.resolve('blocked-tenant')).resolves.toBeNull();
  });
});
