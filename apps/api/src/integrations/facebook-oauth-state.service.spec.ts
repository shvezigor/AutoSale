import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { FacebookOAuthStateService } from './facebook-oauth-state.service.js';

vi.mock('@autosale/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@autosale/database')>();
  return {
    ...actual,
    withTenantTransaction: <T>(
      prisma: { $transaction: (operation: (transaction: unknown) => Promise<T>) => Promise<T> },
      _tenantId: string,
      operation: (transaction: unknown) => Promise<T>,
    ) => prisma.$transaction(operation),
  };
});

type Attempt = {
  id: string;
  tokenHash: string;
  tenantId: string;
  userId: string;
  returnPath: string;
  expiresAt: Date;
  usedAt: Date | null;
  encryptedPageCandidates: string | null;
  candidateExpiresAt: Date | null;
};

class Store {
  attempts: Attempt[] = [];
  cleanupPending = false;
  audit: Array<Record<string, unknown>> = [];

  prisma: any = {
    facebookCredentialCleanup: {
      findFirst: async () => this.cleanupPending ? { id: 'cleanup-a' } : null,
    },
    facebookOAuthAttempt: {
      updateMany: async ({ where, data }: { where: { tenantId: string; usedAt: null }; data: Partial<Attempt> }) => {
        const rows = this.attempts.filter((row) => row.tenantId === where.tenantId && row.usedAt === null);
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      },
      create: async ({ data }: { data: Omit<Attempt, 'usedAt' | 'encryptedPageCandidates' | 'candidateExpiresAt'> }) => {
        const row: Attempt = { ...data, usedAt: null, encryptedPageCandidates: null, candidateExpiresAt: null };
        this.attempts.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = this.attempts.find((candidate) => candidate.id === where.id);
        return row ? { id: row.id, tenantId: row.tenantId, userId: row.userId, returnPath: row.returnPath } : null;
      },
    },
    securityAuditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        this.audit.push(data);
        return data;
      },
    },
    $queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      const hash = values[0];
      const now = values[1];
      if (typeof hash !== 'string' || !(now instanceof Date)) return [];
      const attempt = this.attempts.find((row) => row.tokenHash === hash && row.usedAt === null && row.expiresAt > now);
      if (!attempt) return [];
      attempt.usedAt = now;
      return [{ tenant_id: attempt.tenantId, attempt_id: attempt.id }];
    },
    $transaction: async <T>(callback: (transaction: unknown) => Promise<T>) => callback(this.prisma),
  };
}

describe('FacebookOAuthStateService', () => {
  it('stores only a tenant-bound SHA-256 state hash and a safe return path', async () => {
    const store = new Store();
    const service = new FacebookOAuthStateService(store.prisma as never);
    const raw = await service.issue({ tenantId: 'tenant-a', userId: 'owner-a', returnPath: '/settings?tab=social' });

    expect(store.attempts[0]).toMatchObject({
      tokenHash: createHash('sha256').update(raw).digest('hex'),
      tenantId: 'tenant-a',
      userId: 'owner-a',
      returnPath: '/settings?tab=social',
    });
    expect(store.attempts[0]?.tokenHash).not.toBe(raw);
    expect(store.audit[0]?.action).toBe('FACEBOOK_CONNECT_STARTED');
  });

  it('normalizes unsafe redirects and blocks reconnect during cleanup', async () => {
    const store = new Store();
    const service = new FacebookOAuthStateService(store.prisma as never);

    await service.issue({ tenantId: 'tenant-a', userId: 'owner-a', returnPath: '//attacker.example' });
    expect(store.attempts[0]?.returnPath).toBe('/settings?tab=social');

    store.cleanupPending = true;
    await expect(service.issue({ tenantId: 'tenant-a', userId: 'owner-a' })).rejects.toThrow('Facebook cleanup pending');
  });

  it('consumes a state once before returning its binding', async () => {
    const store = new Store();
    const service = new FacebookOAuthStateService(store.prisma as never);
    const raw = await service.issue({ tenantId: 'tenant-a', userId: 'owner-a' });

    await expect(service.consume(raw)).resolves.toMatchObject({ tenantId: 'tenant-a', userId: 'owner-a' });
    await expect(service.consume(raw)).rejects.toThrow('Invalid or expired Facebook OAuth state');
  });

  it('invalidates older unused attempts for the same tenant', async () => {
    const store = new Store();
    const service = new FacebookOAuthStateService(store.prisma as never);
    const older = await service.issue({ tenantId: 'tenant-a', userId: 'owner-a' });
    const current = await service.issue({ tenantId: 'tenant-a', userId: 'owner-a' });

    await expect(service.consume(older)).rejects.toThrow('Invalid or expired Facebook OAuth state');
    await expect(service.consume(current)).resolves.toMatchObject({ tenantId: 'tenant-a' });
  });
});
