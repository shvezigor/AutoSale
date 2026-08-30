import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { InstagramOAuthStateService } from './instagram-oauth-state.service.js';

type OAuthStateRow = {
  id: string;
  tokenHash: string;
  tenantId: string;
  userId: string;
  returnPath: string;
  expiresAt: Date;
  usedAt: Date | null;
};

type OAuthStatePrisma = {
  instagramConnection: {
    findUnique: (input: { where: { tenantId: string }; select: { status: true; encryptedAccessToken: true } }) => Promise<{ status: string; encryptedAccessToken: string | null } | null>;
  };
  instagramCredentialCleanup: {
    findFirst: (input: {
      where: { tenantId: string; terminalAt: null };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
  };
  instagramOAuthState: {
    create: (input: { data: Omit<OAuthStateRow, 'usedAt'> & { usedAt?: Date | null } }) => Promise<OAuthStateRow>;
    updateMany: (input: {
      where: { tenantId?: string; usedAt?: null };
      data: { usedAt: Date };
    }) => Promise<{ count: number }>;
    updateManyAndReturn: (input: {
      where: {
        tokenHash?: string;
        usedAt?: null;
        expiresAt?: { gt?: Date };
      };
      data: { usedAt: Date };
      select: { id: true; tenantId: true; userId: true; returnPath: true };
    }) => Promise<Array<Pick<OAuthStateRow, 'id' | 'tenantId' | 'userId' | 'returnPath'>>>;
  };
  securityAuditLog: {
    create: (input: { data: { tenantId: string; userId: string; actor: string; action: string; result: string; metadata: Record<string, never> } }) => Promise<unknown>;
  };
  tenant: { update: () => Promise<Record<string, never>> };
  $transaction: <T>(callback: (transaction: OAuthStatePrisma) => Promise<T>) => Promise<T>;
};

class OAuthStateStore {
  readonly rows: OAuthStateRow[] = [];
  readonly auditRows: Array<{ tenantId: string; userId: string; actor: string; action: string; result: string; metadata: Record<string, never> }> = [];
  connectionRow: { status: string; encryptedAccessToken: string | null } | null = null;
  cleanupRow: { id: string; terminalAt?: Date | null } | null = null;

  readonly prisma: OAuthStatePrisma = {
    instagramConnection: {
      findUnique: async () => this.connectionRow,
    },
    instagramCredentialCleanup: {
        findFirst: async () => this.cleanupRow && this.cleanupRow.terminalAt !== undefined && this.cleanupRow.terminalAt !== null
          ? null
          : this.cleanupRow,
    },
    instagramOAuthState: {
      create: async ({ data }: { data: Omit<OAuthStateRow, 'usedAt'> & { usedAt?: Date | null } }) => {
        const row = { ...data, usedAt: data.usedAt ?? null };
        this.rows.push(row);
        return row;
      },
      updateMany: async ({ where, data }: {
        where: { tenantId?: string; usedAt?: null };
        data: { usedAt: Date };
      }) => {
        const rows = this.rows.filter((row) =>
          (where.tenantId === undefined || row.tenantId === where.tenantId) &&
          (where.usedAt === undefined || row.usedAt === where.usedAt),
        );
        for (const row of rows) row.usedAt = data.usedAt;
        return { count: rows.length };
      },
      updateManyAndReturn: async ({
        where,
        data,
        select,
      }: {
        where: {
          tokenHash?: string;
          usedAt?: null;
          expiresAt?: { gt?: Date };
        };
        data: { usedAt: Date };
        select: { id: true; tenantId: true; userId: true; returnPath: true };
      }) => {
        const rows = this.rows.filter((row) =>
          (where.tokenHash === undefined || row.tokenHash === where.tokenHash) &&
          (where.usedAt === undefined || row.usedAt === where.usedAt) &&
          (where.expiresAt?.gt === undefined || row.expiresAt > where.expiresAt.gt),
        );

        for (const row of rows) {
          row.usedAt = data.usedAt;
        }

        return rows.map(({ id, tenantId, userId, returnPath }) => ({
          id,
          tenantId,
          userId,
          returnPath,
        }));
      },
    },
    securityAuditLog: {
      create: async ({ data }) => {
        this.auditRows.push(data);
        return data;
      },
    },
    tenant: { update: async () => ({}) },
    $transaction: async <T>(callback: (transaction: OAuthStatePrisma) => Promise<T>) => callback(this.prisma),
  };
}

function createService(store = new OAuthStateStore()): {
  service: InstagramOAuthStateService;
  store: OAuthStateStore;
} {
  return { service: new InstagramOAuthStateService(store.prisma as never), store };
}

describe('InstagramOAuthStateService', () => {
  it('stores only a SHA-256 hash when creating a tenant-bound state', async () => {
    const { service, store } = createService();
    const beforeCreation = Date.now();

    const rawState = await service.create({
      tenantId: 'tenant-a',
      userId: 'user-a',
      returnPath: '/settings?tab=instagram',
    });

    const stored = store.rows[0];
    expect(stored).toMatchObject({
      tokenHash: createHash('sha256').update(rawState).digest('hex'),
      tenantId: 'tenant-a',
      userId: 'user-a',
      returnPath: '/settings?tab=instagram',
      usedAt: null,
    });
    expect(stored?.tokenHash).not.toBe(rawState);
    expect(stored?.expiresAt.getTime()).toBeGreaterThanOrEqual(beforeCreation + 10 * 60 * 1000);
    expect(stored?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 10 * 60 * 1000);
    expect(store.auditRows).toEqual([{
      tenantId: 'tenant-a',
      userId: 'user-a',
      actor: 'USER',
      action: 'INSTAGRAM_CONNECT_STARTED',
      result: 'SUCCESS',
      metadata: {},
    }]);
  });

  it('blocks reconnect only while a durable credential cleanup is incomplete', async () => {
    const { service, store } = createService();
    store.connectionRow = { status: 'DISCONNECTED', encryptedAccessToken: null };
    store.cleanupRow = { id: 'cleanup-a' };

    await expect(service.create({ tenantId: 'tenant-a', userId: 'user-a' })).rejects.toThrow('Instagram cleanup pending');

    expect(store.rows).toHaveLength(0);
    expect(store.auditRows).toHaveLength(0);

    store.cleanupRow = null;
    await expect(service.create({ tenantId: 'tenant-a', userId: 'user-a' })).resolves.toEqual(expect.any(String));
    expect(store.rows).toHaveLength(1);
  });

  it('allows reconnect after cleanup is terminally abandoned', async () => {
    const { service, store } = createService();
    store.connectionRow = { status: 'DISCONNECTED', encryptedAccessToken: null };
    store.cleanupRow = { id: 'cleanup-a', terminalAt: new Date('2026-08-28T12:00:00.000Z') };

    await expect(service.create({ tenantId: 'tenant-a', userId: 'user-a' })).resolves.toEqual(expect.any(String));
    expect(store.rows).toHaveLength(1);
    expect(store.auditRows[0]?.action).toBe('INSTAGRAM_CONNECT_STARTED');
  });

  it.each([
    '//attacker.example',
    '\\attacker.example',
    '/settings\\attacker',
    'https://attacker.example',
    'http://attacker.example',
    '/settings\nattacker',
  ])('normalizes unsafe return path %j to settings', async (returnPath) => {
    const { service, store } = createService();

    await service.create({ tenantId: 'tenant-a', userId: 'user-a', returnPath });

    expect(store.rows[0]?.returnPath).toBe('/settings');
  });

  it('consumes a valid state and returns its bound tenant, user, and return path', async () => {
    const { service, store } = createService();
    const rawState = await service.create({
      tenantId: 'tenant-a',
      userId: 'user-a',
      returnPath: '/settings?tab=instagram',
    });

    await expect(service.consume(rawState)).resolves.toEqual({
      id: expect.any(String),
      tenantId: 'tenant-a',
      userId: 'user-a',
      returnPath: '/settings?tab=instagram',
    });
    expect(store.rows[0]?.usedAt).toBeInstanceOf(Date);
  });

  it('rejects missing, expired, and reused states with one safe error', async () => {
    const { service, store } = createService();
    const rawState = await service.create({ tenantId: 'tenant-a', userId: 'user-a' });
    store.rows[0]!.expiresAt = new Date(Date.now() - 1);

    await expect(service.consume('not-a-state')).rejects.toThrow('Invalid or expired OAuth state');
    await expect(service.consume(rawState)).rejects.toThrow('Invalid or expired OAuth state');

    store.rows[0]!.expiresAt = new Date(Date.now() + 60_000);
    await service.consume(rawState);
    await expect(service.consume(rawState)).rejects.toThrow('Invalid or expired OAuth state');
  });

  it('allows exactly one concurrent consumer by conditionally marking the state used', async () => {
    const { service } = createService();
    const rawState = await service.create({ tenantId: 'tenant-a', userId: 'user-a' });

    const results = await Promise.allSettled([service.consume(rawState), service.consume(rawState)]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason.message).toBe('Invalid or expired OAuth state');
  });

  it('invalidates every older unused state for the tenant before issuing the next state', async () => {
    const { service } = createService();
    const older = await service.create({ tenantId: 'tenant-a', userId: 'user-a' });
    const current = await service.create({ tenantId: 'tenant-a', userId: 'user-a' });

    await expect(service.consume(older)).rejects.toThrow('Invalid or expired OAuth state');
    await expect(service.consume(current)).resolves.toMatchObject({ tenantId: 'tenant-a', userId: 'user-a' });
  });
});
