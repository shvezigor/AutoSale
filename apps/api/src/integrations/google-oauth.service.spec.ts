import { Buffer } from 'node:buffer';

import { describe, expect, it, vi } from 'vitest';

import { CredentialCipher } from './credential-cipher.js';
import { GoogleOAuthService } from './google-oauth.service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';

const createFixture = () => {
  let connection: any = null;
  const prisma = {
    tenantMembership: { findFirst: vi.fn().mockResolvedValue({ id: 'membership' }) },
    googleConnection: {
      findUnique: vi.fn(async () => connection),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      upsert: vi.fn(async ({ create, update }: any) => {
        connection = connection
          ? { createdAt: new Date('2026-09-02T19:00:00.000Z'), lastErrorCode: null, ...connection, ...update }
          : { createdAt: new Date('2026-09-02T20:00:00.000Z'), lastErrorCode: null, ...create };
        return connection;
      }),
    },
    securityAuditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const states = {
    createAttempt: vi.fn().mockResolvedValue({ state: 'state-value' }),
    consumeAttempt: vi.fn().mockResolvedValue({ id: 'attempt', tenantId, userId, returnPath: '/settings?tab=google' }),
  };
  const client = {
    getAuthorizationUrl: vi.fn(({ state }: any) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`),
    exchangeCode: vi.fn().mockResolvedValue({
      refreshToken: 'refresh-token',
      subject: 'google-subject',
      email: 'owner@example.com',
      grantedScopes: ['openid', 'email', 'https://www.googleapis.com/auth/drive.file'],
    }),
    revokeRefreshToken: vi.fn().mockResolvedValue(undefined),
    refreshAccessToken: vi.fn().mockResolvedValue('access-token'),
  };
  const cipher = new CredentialCipher(Buffer.alloc(32, 9));
  const service = new GoogleOAuthService(prisma as never, client, states as never, cipher, () => new Date('2026-09-02T20:00:00.000Z'));
  return { service, prisma, client, states, cipher, getConnection: () => connection, setConnection: (value: any) => { connection = value; } };
};

describe('GoogleOAuthService', () => {
  it('starts an offline least-privilege authorization attempt', async () => {
    const { service, client, states } = createFixture();

    await expect(service.start(tenantId, userId, '/settings?tab=google')).resolves.toEqual({
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=state-value',
    });
    expect(states.createAttempt).toHaveBeenCalledWith({ tenantId, userId, returnPath: '/settings?tab=google' });
    expect(client.getAuthorizationUrl).toHaveBeenCalledWith(expect.objectContaining({ state: 'state-value', accessType: 'offline' }));
  });

  it('encrypts a refresh token and stores only the tenant-bound Google identity', async () => {
    const { service, getConnection, cipher } = createFixture();

    await service.complete({ code: 'authorization-code', state: 'state-value' });

    const stored = getConnection();
    expect(stored).toMatchObject({ tenantId, googleSubject: 'google-subject', accountEmail: 'owner@example.com', status: 'ACTIVE' });
    expect(stored.encryptedRefreshToken).not.toContain('refresh-token');
    expect(cipher.decrypt(stored.encryptedRefreshToken)).toBe('refresh-token');
  });

  it('rejects a callback if the bound user is no longer an active owner', async () => {
    const { service, prisma } = createFixture();
    prisma.tenantMembership.findFirst.mockResolvedValue(null);

    await expect(service.complete({ code: 'authorization-code', state: 'state-value' })).rejects.toThrow('Google connection failed');
  });

  it('preserves an existing refresh token only when reconnecting the same Google subject', async () => {
    const { service, client, cipher, setConnection, getConnection } = createFixture();
    setConnection({ tenantId, googleSubject: 'google-subject', encryptedRefreshToken: cipher.encrypt('existing-token'), status: 'ACTIVE' });
    client.exchangeCode.mockResolvedValue({ refreshToken: null, subject: 'google-subject', email: 'owner@example.com', grantedScopes: ['https://www.googleapis.com/auth/drive.file'] });

    await service.complete({ code: 'authorization-code', state: 'state-value' });

    expect(cipher.decrypt(getConnection().encryptedRefreshToken)).toBe('existing-token');
  });

  it('rejects a tokenless reconnect for a different Google subject', async () => {
    const { service, client, cipher, setConnection } = createFixture();
    setConnection({ tenantId, googleSubject: 'old-subject', encryptedRefreshToken: cipher.encrypt('existing-token'), status: 'ACTIVE' });
    client.exchangeCode.mockResolvedValue({ refreshToken: null, subject: 'new-subject', email: 'new@example.com', grantedScopes: ['https://www.googleapis.com/auth/drive.file'] });

    await expect(service.complete({ code: 'authorization-code', state: 'state-value' })).rejects.toThrow('Google connection failed');
  });

  it('refreshes a short-lived access token only from the active tenant connection', async () => {
    const { service, client, cipher, setConnection } = createFixture();
    setConnection({ tenantId, encryptedRefreshToken: cipher.encrypt('refresh-a'), credentialGenerationId: 'generation-a', status: 'ACTIVE' });

    await expect(service.getAccessToken(tenantId)).resolves.toBe('access-token');

    expect(client.refreshAccessToken).toHaveBeenCalledWith('refresh-a');
  });

  it('hides account identity and scopes from manager-safe summaries', async () => {
    const { service, setConnection } = createFixture();
    setConnection({
      status: 'ACTIVE', accountEmail: 'owner@gmail.com', grantedScopes: 'openid email drive.file',
      createdAt: new Date('2026-09-03T06:00:00.000Z'), lastVerifiedAt: new Date('2026-09-03T06:00:00.000Z'), lastErrorCode: null,
    });

    await expect(service.summary(tenantId, false)).resolves.toMatchObject({ email: null, grantedScopes: [] });
  });
});
