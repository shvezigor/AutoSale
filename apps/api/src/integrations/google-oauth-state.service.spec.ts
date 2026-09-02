import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { GoogleOAuthStateService } from './google-oauth-state.service.js';

type Row = {
  id: string;
  tokenHash: string;
  tenantId: string;
  userId: string;
  returnPath: string;
  expiresAt: Date;
  usedAt: Date | null;
};

class Store {
  readonly rows: Row[] = [];

  // The in-memory test double is intentionally structural; production types are
  // verified separately against the generated Prisma client.
  readonly prisma: any = {
    googleOAuthAttempt: {
      updateMany: async ({ where, data }: { where: { tenantId?: string; usedAt?: null }; data: { usedAt: Date } }) => {
        const matches = this.rows.filter((row) =>
          (where.tenantId === undefined || row.tenantId === where.tenantId) &&
          (where.usedAt === undefined || row.usedAt === where.usedAt));
        for (const row of matches) row.usedAt = data.usedAt;
        return { count: matches.length };
      },
      create: async ({ data }: { data: Row }) => {
        this.rows.push(data);
        return data;
      },
      updateManyAndReturn: async ({ where, data }: {
        where: { tokenHash: string; usedAt: null; expiresAt: { gt: Date } };
        data: { usedAt: Date };
      }) => {
        const matches = this.rows.filter((row) =>
          row.tokenHash === where.tokenHash && row.usedAt === null && row.expiresAt > where.expiresAt.gt);
        for (const row of matches) row.usedAt = data.usedAt;
        return matches.map(({ id, tenantId, userId, returnPath }) => ({ id, tenantId, userId, returnPath }));
      },
    },
    $transaction: async <T>(callback: (transaction: Store['prisma']) => Promise<T>) => callback(this.prisma),
  };
}

const createService = () => {
  const store = new Store();
  return { store, service: new GoogleOAuthStateService(store.prisma as never) };
};

describe('GoogleOAuthStateService', () => {
  it('stores a tenant-bound SHA-256 state for ten minutes', async () => {
    const { service, store } = createService();
    const before = Date.now();

    const result = await service.createAttempt({ tenantId: 'tenant-a', userId: 'user-a', returnPath: '/settings?tab=google' });

    expect(store.rows[0]).toMatchObject({
      tokenHash: createHash('sha256').update(result.state).digest('hex'),
      tenantId: 'tenant-a',
      userId: 'user-a',
      returnPath: '/settings?tab=google',
      usedAt: null,
    });
    expect(store.rows[0]!.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 600_000);
  });

  it('normalizes an unsafe return path', async () => {
    const { service, store } = createService();

    await service.createAttempt({ tenantId: 'tenant-a', userId: 'user-a', returnPath: '//attacker.example' });

    expect(store.rows[0]?.returnPath).toBe('/settings');
  });

  it('consumes a state exactly once and returns its tenant and owner binding', async () => {
    const { service } = createService();
    const { state } = await service.createAttempt({ tenantId: 'tenant-a', userId: 'user-a' });

    await expect(service.consumeAttempt(state)).resolves.toMatchObject({ tenantId: 'tenant-a', userId: 'user-a' });
    await expect(service.consumeAttempt(state)).rejects.toThrow('Invalid or expired Google OAuth state');
  });

  it('invalidates the previous unused attempt when a new one is created', async () => {
    const { service } = createService();
    const previous = await service.createAttempt({ tenantId: 'tenant-a', userId: 'user-a' });
    const current = await service.createAttempt({ tenantId: 'tenant-a', userId: 'user-a' });

    await expect(service.consumeAttempt(previous.state)).rejects.toThrow('Invalid or expired Google OAuth state');
    await expect(service.consumeAttempt(current.state)).resolves.toMatchObject({ tenantId: 'tenant-a' });
  });
});
