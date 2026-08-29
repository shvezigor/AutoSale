import { Buffer } from 'node:buffer';

import { MetaInstagramError } from '@autosale/integrations';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CredentialCipher } from './credential-cipher.js';
import { InstagramOAuthService } from './instagram-oauth.service.js';

const now = new Date('2026-08-28T12:00:00.000Z');
const callbackUri = 'https://demo.ngrok-free.app/api/integrations/instagram/callback';

function connection(overrides: Record<string, unknown> = {}) {
  return {
    id: 'connection-a',
    tenantId: 'tenant-a',
    externalAccountId: '17841400000000000',
    displayName: 'autosale_store',
    status: 'ACTIVE',
    encryptedAccessToken: 'encrypted-token',
    tokenExpiresAt: new Date('2026-10-27T12:00:00.000Z'),
    lastVerifiedAt: now,
    lastErrorCode: null,
    disconnectedAt: null,
    ...overrides,
  };
}

function setup(nowFn: () => Date = () => now) {
  const findUnique = vi.fn();
  const upsert = vi.fn();
  const update = vi.fn();
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const updateManyAndReturn = vi.fn();
  const oauthStateUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
  const auditCreate = vi.fn().mockResolvedValue({ id: 'audit-a' });
  const tenantFindUnique = vi.fn().mockResolvedValue({ status: 'ACTIVE' });
  const tenantUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const membershipFindUnique = vi.fn().mockResolvedValue({
    role: 'OWNER',
    status: 'ACTIVE',
    user: { status: 'ACTIVE' },
  });
  const prisma = {
    instagramConnection: { findUnique, upsert, update, updateMany, updateManyAndReturn },
    instagramOAuthState: { updateMany: oauthStateUpdateMany },
    securityAuditLog: { create: auditCreate },
    tenant: { findUnique: tenantFindUnique, updateMany: tenantUpdateMany },
    tenantMembership: { findUnique: membershipFindUnique, updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    user: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  (prisma as { $transaction?: unknown }).$transaction = async <T>(callback: (transaction: typeof prisma) => Promise<T>) => callback(prisma);
  const state = {
    create: vi.fn().mockResolvedValue('state-token'),
    consume: vi.fn().mockResolvedValue({
      id: 'attempt-a', tenantId: 'tenant-a',
      userId: 'user-a',
      returnPath: '/settings?tab=instagram',
    }),
  };
  const meta = {
    getAuthorizationUrl: vi.fn().mockReturnValue(
      `https://www.instagram.com/oauth/authorize?state=state-token&redirect_uri=${encodeURIComponent(callbackUri)}`,
    ),
    exchangeCode: vi.fn().mockResolvedValue({ accessToken: 'long-lived-token', expiresIn: 60 * 24 * 60 * 60, grantedScopes: ['instagram_business_basic', 'instagram_business_manage_messages'] }),
    getIdentity: vi.fn().mockResolvedValue({ accountId: '17841400000000000', username: 'autosale_store' }),
    subscribe: vi.fn().mockResolvedValue(undefined),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
    revoke: vi.fn().mockResolvedValue(undefined),
  };
  const cipher = new CredentialCipher(Buffer.alloc(32, 7));
  const service = new InstagramOAuthService(
    prisma as never,
    meta as never,
    state as never,
    cipher,
    'https://demo.ngrok-free.app',
    nowFn,
  );

  return {
    service, prisma, state, meta, findUnique, upsert, update, updateMany, updateManyAndReturn,
    oauthStateUpdateMany, auditCreate,
    tenantFindUnique, tenantUpdateMany, membershipFindUnique,
  };
}

describe('InstagramOAuthService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates tenant and user bound state and returns its Meta authorization URL', async () => {
    const { service, state, meta } = setup();

    await expect(service.connect('tenant-a', 'user-a', '/settings?tab=instagram')).resolves.toEqual({
      authorizationUrl: expect.stringContaining('state=state-token'),
    });
    expect(state.create).toHaveBeenCalledWith({ tenantId: 'tenant-a', userId: 'user-a', returnPath: '/settings?tab=instagram' });
    expect(meta.getAuthorizationUrl).toHaveBeenCalledWith({ state: 'state-token', redirectUri: callbackUri });
  });

  it('consumes state before exchanging a callback and activates only after subscription succeeds', async () => {
    const { service, state, meta, findUnique, upsert, update, auditCreate } = setup();
    const order: string[] = [];
    state.consume.mockImplementation(async () => {
      order.push('consume');
      return { tenantId: 'tenant-a', userId: 'user-a', returnPath: '/settings?tab=instagram' };
    });
    meta.exchangeCode.mockImplementation(async () => {
      order.push('exchange');
      return {
        accessToken: 'long-lived-token',
        expiresIn: 60 * 24 * 60 * 60,
        grantedScopes: ['instagram_business_basic', 'instagram_business_manage_messages'],
      };
    });
    meta.subscribe.mockImplementation(async () => {
      order.push('subscribe');
    });
    findUnique.mockResolvedValue(null);
    upsert.mockResolvedValue(connection({ status: 'ERROR' }));
    update.mockResolvedValue(connection());

    await expect(service.completeCallback('authorization-code', 'raw-state')).resolves.toEqual({
      returnPath: '/settings?tab=instagram',
      summary: {
        status: 'ACTIVE',
        accountId: '17841400000000000',
        username: 'autosale_store',
        tokenExpiresAt: '2026-10-27T12:00:00.000Z',
        lastVerifiedAt: '2026-08-28T12:00:00.000Z',
        lastErrorCode: null,
      },
    });

    expect(order).toEqual(['consume', 'exchange', 'subscribe']);
    expect(meta.exchangeCode).toHaveBeenCalledWith({ code: 'authorization-code', redirectUri: callbackUri });
    expect(meta.getIdentity).toHaveBeenCalledWith('long-lived-token');
    const write = upsert.mock.calls[0]![0];
    expect(write.where).toEqual({ tenantId: 'tenant-a' });
    expect(write.create).toMatchObject({
      tenantId: 'tenant-a',
      externalAccountId: '17841400000000000',
      displayName: 'autosale_store',
      status: 'ERROR',
      connectedByUserId: 'user-a',
    });
    expect(write.create.encryptedAccessToken).not.toBe('long-lived-token');
    expect(write.create.grantedScopes).toBe('instagram_business_basic,instagram_business_manage_messages');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-a' },
      data: expect.objectContaining({ status: 'ACTIVE', lastVerifiedAt: now, lastErrorCode: null }),
    }));
    expect(auditCreate).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-a',
        userId: 'user-a',
        actor: 'USER',
        action: 'INSTAGRAM_CONNECTED',
        result: 'SUCCESS',
        metadata: {},
      },
    });
    expect(JSON.stringify(auditCreate.mock.calls)).not.toMatch(/authorization-code|long-lived-token|encrypted-token/);
  });

  it('consumes a provider denial and records its stable safe category', async () => {
    const { service, meta, updateMany, auditCreate } = setup();

    await expect(service.completeCallback(undefined, 'raw-state', true)).rejects.toThrow('Instagram connection failed');

    expect(meta.exchangeCode).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a' },
      data: { status: 'ERROR', lastErrorCode: 'META_AUTHORIZATION_DENIED' },
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-a',
        userId: 'user-a',
        action: 'INSTAGRAM_CALLBACK_FAILED',
        result: 'FAILURE',
        metadata: { errorCode: 'META_AUTHORIZATION_DENIED' },
      }),
    });
  });

  it.each([
    ['blocked tenant', 'tenantFindUnique', { status: 'BLOCKED' }],
    ['removed owner membership', 'membershipFindUnique', null],
    ['blocked owner membership', 'membershipFindUnique', { role: 'OWNER', status: 'BLOCKED', user: { status: 'ACTIVE' } }],
    ['demoted owner membership', 'membershipFindUnique', { role: 'MANAGER', status: 'ACTIVE', user: { status: 'ACTIVE' } }],
    ['blocked owner user', 'membershipFindUnique', { role: 'OWNER', status: 'ACTIVE', user: { status: 'BLOCKED' } }],
  ])('fails closed before Meta exchange for a %s', async (_name, stub, value) => {
    const { service, meta, tenantFindUnique, membershipFindUnique } = setup();
    if (stub === 'tenantFindUnique') tenantFindUnique.mockResolvedValue(value);
    else membershipFindUnique.mockResolvedValue(value);

    await expect(service.completeCallback('authorization-code', 'raw-state')).rejects.toThrow('Instagram connection failed');

    expect(meta.exchangeCode).not.toHaveBeenCalled();
  });

  it('fails safely before persistence when Meta did not grant every required scope', async () => {
    const { service, findUnique, upsert, meta, updateMany } = setup();
    findUnique.mockResolvedValue(null);
    meta.exchangeCode.mockResolvedValue({ accessToken: 'long-lived-token', expiresIn: 60, grantedScopes: ['instagram_business_basic'] });

    await expect(service.completeCallback('authorization-code', 'raw-state')).rejects.toThrow('Instagram connection failed');

    expect(upsert).not.toHaveBeenCalled();
    expect(meta.subscribe).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a' },
      data: { status: 'ERROR', lastErrorCode: 'META_REQUIRED_SCOPES_MISSING' },
    });
  });

  it('rechecks tenant authorization in the serialized final write after provider I/O', async () => {
    const { service, tenantUpdateMany, upsert } = setup();
    tenantUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.completeCallback('authorization-code', 'raw-state')).rejects.toThrow('Instagram connection failed');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('rejects an older consumed attempt after a newer state becomes current', async () => {
    const { service, state, tenantUpdateMany, upsert } = setup();
    state.consume.mockResolvedValue({ id: 'older-attempt', tenantId: 'tenant-a', userId: 'user-a', returnPath: '/settings' });
    tenantUpdateMany.mockResolvedValue({ count: 0 });

    await expect(service.completeCallback('authorization-code', 'raw-state')).rejects.toThrow('Instagram connection failed');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('never activates an already expired exchanged credential', async () => {
    const { service, meta, upsert } = setup();
    meta.exchangeCode.mockResolvedValue({
      accessToken: 'long-lived-token',
      expiresIn: -1,
      grantedScopes: ['instagram_business_basic', 'instagram_business_manage_messages'],
    });
    await expect(service.completeCallback('authorization-code', 'raw-state')).rejects.toThrow('Instagram connection failed');
    expect(upsert).not.toHaveBeenCalled();
    expect(meta.subscribe).not.toHaveBeenCalled();
  });

  it('fails closed when the Instagram account belongs to another tenant', async () => {
    const { service, findUnique, upsert, meta } = setup();
    findUnique.mockResolvedValue(connection({ tenantId: 'tenant-b' }));

    await expect(service.completeCallback('authorization-code', 'raw-state')).rejects.toThrow('Instagram connection failed');

    expect(upsert).not.toHaveBeenCalled();
    expect(meta.subscribe).not.toHaveBeenCalled();
  });

  it('marks a stored credential ERROR when subscription fails instead of exposing it as ACTIVE', async () => {
    const { service, findUnique, upsert, update, updateMany, meta } = setup();
    findUnique.mockResolvedValue(null);
    upsert.mockResolvedValue(connection({ status: 'ERROR' }));
    meta.subscribe.mockRejectedValue(new MetaInstagramError(500, 2));
    update.mockResolvedValue(connection({ status: 'ERROR', lastErrorCode: 'META_SUBSCRIPTION_FAILED' }));

    await expect(service.completeCallback('authorization-code', 'raw-state')).rejects.toThrow('Instagram connection failed');

    expect(updateMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a' },
      data: { status: 'ERROR', lastErrorCode: 'META_SUBSCRIPTION_FAILED' },
    });
    expect(update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE' }) }));
  });

  it('does not activate a token that expires while Meta subscription is in flight', async () => {
    let clock = now;
    const { service, findUnique, upsert, update, meta } = setup(() => clock);
    findUnique.mockResolvedValue(null);
    upsert.mockResolvedValue(connection({ status: 'ERROR' }));
    meta.exchangeCode.mockResolvedValue({
      accessToken: 'long-lived-token',
      expiresIn: 1,
      grantedScopes: ['instagram_business_basic', 'instagram_business_manage_messages'],
    });
    meta.subscribe.mockImplementation(async () => {
      clock = new Date(now.getTime() + 1_000);
    });

    await expect(service.completeCallback('authorization-code', 'raw-state')).rejects.toThrow('Instagram connection failed');

    expect(update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE' }) }));
  });

  it('does not let a provider failure from a superseded callback downgrade a newer connection', async () => {
    const { service, meta, tenantUpdateMany, updateMany } = setup();
    meta.exchangeCode.mockRejectedValue(new MetaInstagramError(500, 2));
    tenantUpdateMany.mockResolvedValue({ count: 0 });

    await expect(service.completeCallback('authorization-code', 'raw-state')).rejects.toThrow('Instagram connection failed');

    expect(updateMany).not.toHaveBeenCalled();
  });

  it('refuses activation when an owner demotion completed after provider I/O but before the final lock', async () => {
    const { service, meta, upsert, prisma } = setup();
    meta.exchangeCode.mockImplementation(async () => ({
      accessToken: 'long-lived-token',
      expiresIn: 60,
      grantedScopes: ['instagram_business_basic', 'instagram_business_manage_messages'],
    }));
    prisma.tenantMembership.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.completeCallback('authorization-code', 'raw-state')).rejects.toThrow('Instagram connection failed');

    expect(upsert).not.toHaveBeenCalled();
  });

  it('normalizes provider authorization failure and never exposes provider text', async () => {
    const { service, meta, updateMany, auditCreate } = setup();
    const providerFailure = new MetaInstagramError(401, 190);
    Object.defineProperty(providerFailure, 'message', { value: 'secret token rejected by provider' });
    meta.exchangeCode.mockRejectedValue(providerFailure);

    await expect(service.completeCallback('authorization-code', 'raw-state')).rejects.toThrow('Instagram connection failed');

    expect(updateMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a' },
      data: { status: 'REAUTH_REQUIRED', lastErrorCode: 'META_AUTHORIZATION_FAILED' },
    });
    await expect(service.completeCallback('authorization-code', 'raw-state')).rejects.not.toThrow('secret token rejected by provider');
    const serializedAudits = JSON.stringify(auditCreate.mock.calls);
    expect(serializedAudits).toContain('META_AUTHORIZATION_FAILED');
    expect(serializedAudits).not.toContain('authorization-code');
    expect(serializedAudits).not.toContain('long-lived-token');
    expect(serializedAudits).not.toContain('encrypted-token');
    expect(serializedAudits).not.toContain('secret token rejected by provider');
  });

  it('returns a safe summary without credential fields', async () => {
    const { service, findUnique } = setup();
    findUnique.mockResolvedValue(connection());

    const summary = await service.getSummary('tenant-a');

    expect(summary).toEqual({
      status: 'ACTIVE',
      accountId: '17841400000000000',
      username: 'autosale_store',
      tokenExpiresAt: '2026-10-27T12:00:00.000Z',
      lastVerifiedAt: '2026-08-28T12:00:00.000Z',
      lastErrorCode: null,
    });
    expect(summary).not.toHaveProperty('encryptedAccessToken');
  });

  it('treats an expired ACTIVE credential as reauthorization-required without exposing it', async () => {
    const { service, findUnique, updateMany } = setup();
    findUnique.mockResolvedValue(connection({ tokenExpiresAt: new Date('2026-08-28T11:59:59.999Z') }));

    await expect(service.getSummary('tenant-a')).resolves.toEqual({
      status: 'REAUTH_REQUIRED',
      accountId: '17841400000000000',
      username: 'autosale_store',
      tokenExpiresAt: '2026-08-28T11:59:59.999Z',
      lastVerifiedAt: '2026-08-28T12:00:00.000Z',
      lastErrorCode: 'META_TOKEN_EXPIRED',
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-a',
        status: 'ACTIVE',
        tokenExpiresAt: { lte: now },
      },
      data: { status: 'REAUTH_REQUIRED', lastErrorCode: 'META_TOKEN_EXPIRED' },
    });
  });

  it('returns NOT_CONNECTED when the tenant has no Instagram record', async () => {
    const { service, findUnique } = setup();
    findUnique.mockResolvedValue(null);

    await expect(service.getSummary('tenant-a')).resolves.toEqual({
      status: 'NOT_CONNECTED',
      accountId: null,
      username: null,
      tokenExpiresAt: null,
      lastVerifiedAt: null,
      lastErrorCode: null,
    });
  });

  it('supersedes the current attempt and invalidates unused states even when no connection row exists', async () => {
    const { service, findUnique, tenantUpdateMany, oauthStateUpdateMany, auditCreate } = setup();
    findUnique.mockResolvedValue(null);

    await expect(service.disconnect('tenant-a', 'user-a')).resolves.toEqual({
      status: 'NOT_CONNECTED',
      accountId: null,
      username: null,
      tokenExpiresAt: null,
      lastVerifiedAt: null,
      lastErrorCode: null,
    });

    expect(tenantUpdateMany).toHaveBeenCalledWith({
      where: { id: 'tenant-a' },
      data: { instagramOAuthCurrentAttemptId: null },
    });
    expect(oauthStateUpdateMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a', usedAt: null },
      data: { usedAt: now },
    });
    expect(auditCreate.mock.calls.map(([input]) => input.data.action)).toEqual([
      'INSTAGRAM_DISCONNECT_REQUESTED',
      'INSTAGRAM_DISCONNECTED',
    ]);
  });

  it('rejects an already-consumed callback when disconnect supersedes its attempt during provider I/O', async () => {
    const { service, meta, findUnique, tenantUpdateMany, upsert } = setup();
    let currentAttempt: string | null = 'attempt-a';
    tenantUpdateMany.mockImplementation(async (input: { where: { id: string; instagramOAuthCurrentAttemptId?: string }; data: { instagramOAuthCurrentAttemptId?: string | null } }) => {
      if ('instagramOAuthCurrentAttemptId' in input.where && input.where.instagramOAuthCurrentAttemptId !== currentAttempt) return { count: 0 };
      if ('instagramOAuthCurrentAttemptId' in input.data) currentAttempt = input.data.instagramOAuthCurrentAttemptId ?? null;
      return { count: 1 };
    });
    findUnique.mockResolvedValue(null);
    let releaseExchange!: () => void;
    let exchangeStarted!: () => void;
    const started = new Promise<void>((resolve) => { exchangeStarted = resolve; });
    meta.exchangeCode.mockImplementation(async () => {
      exchangeStarted();
      await new Promise<void>((resolve) => { releaseExchange = resolve; });
      return { accessToken: 'long-lived-token', expiresIn: 60, grantedScopes: ['instagram_business_basic', 'instagram_business_manage_messages'] };
    });

    const callback = service.completeCallback('authorization-code', 'raw-state');
    await started;
    await service.disconnect('tenant-a', 'user-a');
    releaseExchange();

    await expect(callback).rejects.toThrow('Instagram connection failed');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('disables locally before remote cleanup, retains a failed cleanup credential, and clears it through the retry workflow', async () => {
    const { service, findUnique, update, updateManyAndReturn, meta, auditCreate } = setup();
    const cipher = new CredentialCipher(Buffer.alloc(32, 7));
    const encryptedAccessToken = cipher.encrypt('remote-token');
    findUnique.mockResolvedValue(connection({ encryptedAccessToken, status: 'DISCONNECTED', lastErrorCode: 'META_DISCONNECT_CLEANUP_FAILED', disconnectedAt: now }));
    const order: string[] = [];
    update
      .mockImplementationOnce(async (input: { data: { status: string } }) => {
        order.push(`local:${input.data.status}`);
        return connection({ status: 'DISCONNECTED', lastErrorCode: 'META_DISCONNECT_CLEANUP_PENDING', disconnectedAt: now });
      });
    updateManyAndReturn
      .mockResolvedValueOnce([connection({ status: 'DISCONNECTED', lastErrorCode: 'META_DISCONNECT_CLEANUP_FAILED', disconnectedAt: now })])
      .mockResolvedValueOnce([connection({ status: 'DISCONNECTED', lastErrorCode: null, tokenExpiresAt: null, disconnectedAt: now })]);
    meta.unsubscribe.mockRejectedValue(new Error('provider unavailable'));
    meta.revoke.mockRejectedValue(new Error('provider unavailable'));
    meta.unsubscribe.mockImplementation(async () => { order.push('unsubscribe'); throw new Error('provider unavailable'); });
    meta.revoke.mockImplementation(async () => { order.push('revoke'); throw new Error('provider unavailable'); });

    await expect(service.disconnect('tenant-a', 'user-a')).resolves.toMatchObject({
      status: 'DISCONNECTED',
      lastErrorCode: 'META_DISCONNECT_CLEANUP_FAILED',
    });

    expect(meta.unsubscribe).toHaveBeenCalledWith('remote-token');
    expect(meta.revoke).toHaveBeenCalledWith('remote-token');
    expect(order.slice(0, 3)).toEqual(['local:DISCONNECTED', 'unsubscribe', 'revoke']);
    expect(updateManyAndReturn).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({
        id: 'connection-a',
        tenantId: 'tenant-a',
        encryptedAccessToken,
        status: 'DISCONNECTED',
        disconnectedAt: now,
        lastErrorCode: 'META_DISCONNECT_CLEANUP_PENDING',
      }),
      data: { lastErrorCode: 'META_DISCONNECT_CLEANUP_FAILED' },
    }));
    expect(auditCreate.mock.calls.map(([input]) => input.data.action)).toContain('INSTAGRAM_CLEANUP_FAILED');

    meta.unsubscribe.mockResolvedValue(undefined);
    meta.revoke.mockResolvedValue(undefined);
    await expect(service.retryCleanup('tenant-a', 'user-a')).resolves.toMatchObject({ status: 'DISCONNECTED', lastErrorCode: null });
    expect(updateManyAndReturn).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        encryptedAccessToken: null,
        tokenExpiresAt: null,
        grantedScopes: null,
      }),
    }));
    expect(auditCreate).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-a',
        userId: 'user-a',
        actor: 'USER',
        action: 'INSTAGRAM_CLEANUP_FAILED',
        result: 'FAILURE',
        metadata: { errorCode: 'META_DISCONNECT_CLEANUP_FAILED' },
      },
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-a',
        userId: 'user-a',
        actor: 'USER',
        action: 'INSTAGRAM_DISCONNECTED',
        result: 'SUCCESS',
        metadata: {},
      },
    });
    expect(JSON.stringify(auditCreate.mock.calls)).not.toMatch(/remote-token|encryptedAccessToken|app-secret|provider unavailable/);
  });

  it('does not decrypt or call Meta when a legacy row has no ciphertext', async () => {
    const { service, findUnique, update, meta } = setup();
    findUnique.mockResolvedValue(connection({ encryptedAccessToken: null, status: 'LEGACY' }));
    update.mockResolvedValue(connection({ status: 'DISCONNECTED', encryptedAccessToken: null }));

    await service.disconnect('tenant-a', 'user-a');

    expect(meta.unsubscribe).not.toHaveBeenCalled();
    expect(meta.revoke).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'DISCONNECTED',
        encryptedAccessToken: null,
        tokenExpiresAt: null,
        grantedScopes: null,
      }),
    }));
  });

  it.each([
    ['successful', undefined],
    ['failed', new Error('provider unavailable')],
  ])('compare-and-set finalization cannot clear or overwrite a concurrent reconnect after %s cleanup', async (_label, cleanupError) => {
    const { service, findUnique, update, updateManyAndReturn, meta } = setup();
    const cipher = new CredentialCipher(Buffer.alloc(32, 7));
    const oldCiphertext = cipher.encrypt('old-remote-token');
    findUnique.mockResolvedValueOnce(connection({ encryptedAccessToken: oldCiphertext }));
    update.mockResolvedValue(connection({ status: 'DISCONNECTED', lastErrorCode: 'META_DISCONNECT_CLEANUP_PENDING', disconnectedAt: now }));
    let releaseCleanup!: () => void;
    let cleanupStarted!: () => void;
    const started = new Promise<void>((resolve) => { cleanupStarted = resolve; });
    meta.unsubscribe.mockImplementation(async () => {
      cleanupStarted();
      await new Promise<void>((resolve) => { releaseCleanup = resolve; });
      if (cleanupError) throw cleanupError;
    });
    if (cleanupError) meta.revoke.mockRejectedValue(cleanupError);
    updateManyAndReturn.mockResolvedValue([]);
    findUnique.mockResolvedValueOnce(connection({
      externalAccountId: '17841499999999999',
      displayName: 'new_store',
      status: 'ACTIVE',
      encryptedAccessToken: cipher.encrypt('new-remote-token'),
      lastErrorCode: null,
    }));

    const disconnect = service.disconnect('tenant-a', 'user-a');
    await started;
    releaseCleanup();

    await expect(disconnect).resolves.toMatchObject({
      status: 'ACTIVE',
      accountId: '17841499999999999',
      username: 'new_store',
      lastErrorCode: null,
    });
    expect(updateManyAndReturn).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ encryptedAccessToken: oldCiphertext }),
    }));
  });
});
