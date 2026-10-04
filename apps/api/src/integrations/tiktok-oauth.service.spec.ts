import { Buffer } from 'node:buffer';

import { describe, expect, it, vi } from 'vitest';

import { CredentialCipher } from './credential-cipher.js';
import { TikTokOAuthService } from './tiktok-oauth.service.js';

vi.mock('@autosale/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@autosale/database')>();
  return {
    ...actual,
    assertTenantAcceptingMutations: vi.fn().mockResolvedValue(undefined),
    withTenantTransaction: <T>(
      prisma: { $transaction: (operation: (transaction: unknown) => Promise<T>) => Promise<T> },
      _tenantId: string,
      operation: (transaction: unknown) => Promise<T>,
    ) => prisma.$transaction(operation),
  };
});

const binding = {
  id: '11111111-1111-4111-8111-111111111111',
  tenantId: 'tenant-a',
  userId: 'owner-a',
  returnPath: '/settings?tab=social',
};

function fixture() {
  const cipher = new CredentialCipher(Buffer.alloc(32, 7));
  let connection: any = null;
  const cleanups: any[] = [];
  const transaction: any = {
    tenant: { findUnique: vi.fn().mockResolvedValue({ status: 'ACTIVE' }) },
    tenantMembership: {
      findUnique: vi.fn().mockResolvedValue({ role: 'OWNER', status: 'ACTIVE', user: { status: 'ACTIVE' } }),
    },
    tikTokConnection: {
      findUnique: vi.fn().mockImplementation(async () => connection),
      upsert: vi.fn().mockImplementation(async ({ create, update }: any) => {
        connection = connection ? { ...connection, ...update } : { id: 'connection-a', ...create };
        return connection;
      }),
      update: vi.fn().mockImplementation(async ({ data }: any) => {
        connection = { ...connection, ...data };
        return connection;
      }),
      updateMany: vi.fn().mockImplementation(async ({ data }: any) => {
        if (connection) connection = { ...connection, ...data };
        return { count: connection ? 1 : 0 };
      }),
    },
    tikTokOAuthAttempt: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    tikTokCredentialCleanup: {
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const row = { id: `cleanup-${cleanups.length + 1}`, terminalAt: null, ...data };
        cleanups.push(row);
        return row;
      }),
      upsert: vi.fn().mockImplementation(async ({ create, update }: any) => {
        const existing = cleanups.find((row) => row.credentialGenerationId === create.credentialGenerationId);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { id: `cleanup-${cleanups.length + 1}`, terminalAt: null, ...create };
        cleanups.push(row);
        return row;
      }),
      findMany: vi.fn().mockImplementation(async () => cleanups.filter((row) => row.terminalAt === null)),
      updateMany: vi.fn().mockImplementation(async ({ where, data }: any) => {
        const row = cleanups.find((candidate) => candidate.id === where.id && candidate.terminalAt === null);
        if (!row) return { count: 0 };
        Object.assign(row, data, data.terminalAt ? { terminalAt: data.terminalAt } : {});
        return { count: 1 };
      }),
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => cleanups.find((row) => row.id === where.id && row.terminalAt === null) ?? null),
    },
    securityAuditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma: any = {
    $transaction: async <T>(callback: (client: typeof transaction) => Promise<T>) => callback(transaction),
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
  const states = { consume: vi.fn().mockResolvedValue(binding), issue: vi.fn().mockResolvedValue('opaque-state') };
  const client = {
    getAuthorizationUrl: vi.fn().mockReturnValue('https://business-api.tiktok.com/portal/auth?state=opaque-state'),
    exchangeCode: vi.fn().mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      accountId: 'fictional-account',
      grantedScopes: ['message.list.manage', 'message.list.read'],
      expiresIn: 3_600,
      refreshTokenExpiresIn: 86_400,
    }),
    getCapabilities: vi.fn().mockResolvedValue({ receiveMessages: true, sendText: false, sendImage: false }),
    getAccount: vi.fn().mockResolvedValue({
      accountId: 'fictional-account', displayName: 'Fictional Shop', username: 'fictional', profileImageUrl: null,
    }),
    revokeToken: vi.fn().mockResolvedValue(undefined),
  };
  const webhookHealth = { assertHealthy: vi.fn().mockResolvedValue(undefined) };
  const service = new TikTokOAuthService(
    prisma,
    client as never,
    states as never,
    cipher,
    webhookHealth,
    'https://sales-aito.example',
    true,
    () => new Date('2026-10-04T20:00:00.000Z'),
  );
  return { service, states, client, webhookHealth, transaction, prisma, cipher, cleanups, getConnection: () => connection };
}

describe('TikTokOAuthService', () => {
  it('creates an authorization URL from one-time state and the provider-generated URL', async () => {
    const { service, states, client } = fixture();
    await expect(service.authorize('tenant-a', 'owner-a', '/settings?tab=social')).resolves.toEqual({
      authorizationUrl: 'https://business-api.tiktok.com/portal/auth?state=opaque-state',
    });
    expect(states.issue).toHaveBeenCalledWith({ tenantId: 'tenant-a', userId: 'owner-a', returnPath: '/settings?tab=social' });
    expect(client.getAuthorizationUrl).toHaveBeenCalledWith({ state: 'opaque-state' });
  });

  it('consumes state first, verifies the shared webhook, and stores encrypted inbound-only credentials', async () => {
    const { service, states, client, webhookHealth, cipher, getConnection } = fixture();

    await expect(service.completeCallback('fictional-code', 'opaque-state')).resolves.toEqual({
      returnPath: '/settings?tab=social',
      summary: expect.objectContaining({ status: 'INBOUND_ONLY', accountId: 'fictional-account' }),
    });

    expect(states.consume.mock.invocationCallOrder[0]).toBeLessThan(client.exchangeCode.mock.invocationCallOrder[0]!);
    expect(webhookHealth.assertHealthy).toHaveBeenCalledTimes(1);
    const stored = getConnection();
    expect(stored.encryptedAccessToken).not.toContain('access-token');
    expect(cipher.decrypt(stored.encryptedAccessToken)).toBe('access-token');
    expect(cipher.decrypt(stored.encryptedRefreshToken)).toBe('refresh-token');
  });

  it('refuses activation without inbound scopes and revokes the newly issued token', async () => {
    const { service, client, getConnection } = fixture();
    client.getCapabilities.mockResolvedValue({ receiveMessages: false, sendText: true, sendImage: true });

    await expect(service.completeCallback('fictional-code', 'opaque-state')).rejects.toThrow('TikTok connection failed');
    expect(client.revokeToken).toHaveBeenCalledWith('access-token');
    expect(getConnection()).toBeNull();
  });

  it('rejects a callback when the state owner is no longer an active owner', async () => {
    const { service, client, transaction } = fixture();
    transaction.tenantMembership.findUnique.mockResolvedValue({
      role: 'MANAGER', status: 'ACTIVE', user: { status: 'ACTIVE' },
    });

    await expect(service.completeCallback('fictional-code', 'opaque-state')).rejects.toThrow('TikTok connection failed');
    expect(client.exchangeCode).not.toHaveBeenCalled();
  });

  it('does not persist credentials when the deployment-level webhook is unhealthy', async () => {
    const { service, client, webhookHealth, getConnection } = fixture();
    webhookHealth.assertHealthy.mockRejectedValue(new Error('unhealthy'));

    await expect(service.completeCallback('fictional-code', 'opaque-state')).rejects.toThrow('TikTok connection failed');
    expect(client.revokeToken).toHaveBeenCalledWith('access-token');
    expect(getConnection()).toBeNull();
  });

  it('rejects an account already connected to another tenant', async () => {
    const { service, client, prisma, getConnection } = fixture();
    prisma.$queryRaw.mockResolvedValue([{ tenant_id: 'tenant-b' }]);

    await expect(service.completeCallback('fictional-code', 'opaque-state')).rejects.toThrow('TikTok connection failed');
    expect(client.revokeToken).toHaveBeenCalledWith('access-token');
    expect(getConnection()).toBeNull();
  });

  it('disconnects by revoking only merchant credentials and never mutates the shared webhook', async () => {
    const { service, client, webhookHealth, getConnection } = fixture();
    await service.completeCallback('fictional-code', 'opaque-state');
    webhookHealth.assertHealthy.mockClear();

    await expect(service.disconnect('tenant-a', 'owner-a')).resolves.toMatchObject({ status: 'DISCONNECTED' });
    expect(client.revokeToken).toHaveBeenCalledWith('access-token');
    expect(webhookHealth.assertHealthy).not.toHaveBeenCalled();
    expect(getConnection()).toMatchObject({ status: 'DISCONNECTED', encryptedAccessToken: null });
  });
});
