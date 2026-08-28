import { Buffer } from 'node:buffer';

import { MetaInstagramError } from '@autosale/integrations';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CredentialCipher } from './credential-cipher.js';
import { InstagramOAuthService } from './instagram-oauth.service.js';

const now = new Date('2026-08-28T12:00:00.000Z');
const callbackUri = 'https://demo.ngrok-free.app/api/integrations/instagram/callback';

function connection(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-a',
    externalAccountId: '17841400000000000',
    displayName: 'autosale_store',
    status: 'ACTIVE',
    encryptedAccessToken: 'encrypted-token',
    tokenExpiresAt: new Date('2026-10-27T12:00:00.000Z'),
    lastVerifiedAt: now,
    lastErrorCode: null,
    ...overrides,
  };
}

function setup() {
  const findUnique = vi.fn();
  const upsert = vi.fn();
  const update = vi.fn();
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    instagramConnection: { findUnique, upsert, update, updateMany },
  };
  const state = {
    create: vi.fn().mockResolvedValue('state-token'),
    consume: vi.fn().mockResolvedValue({
      tenantId: 'tenant-a',
      userId: 'user-a',
      returnPath: '/settings?tab=instagram',
    }),
  };
  const meta = {
    getAuthorizationUrl: vi.fn().mockReturnValue(
      `https://www.instagram.com/oauth/authorize?state=state-token&redirect_uri=${encodeURIComponent(callbackUri)}`,
    ),
    exchangeCode: vi.fn().mockResolvedValue({ accessToken: 'long-lived-token', expiresIn: 60 * 24 * 60 * 60 }),
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
    () => now,
  );

  return { service, prisma, state, meta, findUnique, upsert, update, updateMany };
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
    const { service, state, meta, findUnique, upsert, update } = setup();
    const order: string[] = [];
    state.consume.mockImplementation(async () => {
      order.push('consume');
      return { tenantId: 'tenant-a', userId: 'user-a', returnPath: '/settings?tab=instagram' };
    });
    meta.exchangeCode.mockImplementation(async () => {
      order.push('exchange');
      return { accessToken: 'long-lived-token', expiresIn: 60 * 24 * 60 * 60 };
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
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-a' },
      data: expect.objectContaining({ status: 'ACTIVE', lastVerifiedAt: now, lastErrorCode: null }),
    }));
  });

  it('fails closed when the Instagram account belongs to another tenant', async () => {
    const { service, findUnique, upsert, meta } = setup();
    findUnique.mockResolvedValue(connection({ tenantId: 'tenant-b' }));

    await expect(service.completeCallback('authorization-code', 'raw-state')).rejects.toThrow('Instagram connection failed');

    expect(upsert).not.toHaveBeenCalled();
    expect(meta.subscribe).not.toHaveBeenCalled();
  });

  it('marks a stored credential ERROR when subscription fails instead of exposing it as ACTIVE', async () => {
    const { service, findUnique, upsert, update, meta } = setup();
    findUnique.mockResolvedValue(null);
    upsert.mockResolvedValue(connection({ status: 'ERROR' }));
    meta.subscribe.mockRejectedValue(new MetaInstagramError(500, 2));
    update.mockResolvedValue(connection({ status: 'ERROR', lastErrorCode: 'META_SUBSCRIPTION_FAILED' }));

    await expect(service.completeCallback('authorization-code', 'raw-state')).rejects.toThrow('Instagram connection failed');

    expect(update).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a' },
      data: { status: 'ERROR', lastErrorCode: 'META_SUBSCRIPTION_FAILED' },
    });
    expect(update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE' }) }));
  });

  it('normalizes provider authorization failure and never exposes provider text', async () => {
    const { service, meta, updateMany } = setup();
    const providerFailure = new MetaInstagramError(401, 190);
    Object.defineProperty(providerFailure, 'message', { value: 'secret token rejected by provider' });
    meta.exchangeCode.mockRejectedValue(providerFailure);

    await expect(service.completeCallback('authorization-code', 'raw-state')).rejects.toThrow('Instagram connection failed');

    expect(updateMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a' },
      data: { status: 'REAUTH_REQUIRED', lastErrorCode: 'META_AUTHORIZATION_FAILED' },
    });
    await expect(service.completeCallback('authorization-code', 'raw-state')).rejects.not.toThrow('secret token rejected by provider');
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

  it('attempts unsubscribe and revoke independently, then always clears the local credential', async () => {
    const { service, findUnique, update, meta } = setup();
    const cipher = new CredentialCipher(Buffer.alloc(32, 7));
    findUnique.mockResolvedValue(connection({ encryptedAccessToken: cipher.encrypt('remote-token') }));
    meta.unsubscribe.mockRejectedValue(new Error('provider unavailable'));
    meta.revoke.mockRejectedValue(new Error('provider unavailable'));
    update.mockResolvedValue(connection({
      status: 'DISCONNECTED',
      encryptedAccessToken: null,
      tokenExpiresAt: null,
      lastVerifiedAt: now,
      lastErrorCode: 'META_DISCONNECT_CLEANUP_FAILED',
    }));

    await expect(service.disconnect('tenant-a')).resolves.toMatchObject({
      status: 'DISCONNECTED',
      lastErrorCode: 'META_DISCONNECT_CLEANUP_FAILED',
    });

    expect(meta.unsubscribe).toHaveBeenCalledWith('remote-token');
    expect(meta.revoke).toHaveBeenCalledWith('remote-token');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-a' },
      data: expect.objectContaining({
        status: 'DISCONNECTED',
        encryptedAccessToken: null,
        tokenExpiresAt: null,
        grantedScopes: null,
        disconnectedAt: now,
      }),
    }));
  });

  it('does not decrypt or call Meta when a legacy row has no ciphertext', async () => {
    const { service, findUnique, update, meta } = setup();
    findUnique.mockResolvedValue(connection({ encryptedAccessToken: null, status: 'LEGACY' }));
    update.mockResolvedValue(connection({ status: 'DISCONNECTED', encryptedAccessToken: null }));

    await service.disconnect('tenant-a');

    expect(meta.unsubscribe).not.toHaveBeenCalled();
    expect(meta.revoke).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledOnce();
  });
});
