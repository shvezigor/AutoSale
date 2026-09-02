import { Buffer } from 'node:buffer';

import { MetaInstagramError } from '@autosale/integrations';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CredentialCipher } from './credential-cipher.js';
import { InstagramOAuthService } from './instagram-oauth.service.js';

const now = new Date('2026-08-28T12:00:00.000Z');
const callbackUri = 'https://demo.ngrok-free.app/api/integrations/instagram/callback';

type CleanupTestRow = Record<string, unknown> & {
  id: string;
  credentialGenerationId: string;
  tenantId: string;
  externalAccountId: string;
  encryptedAccessToken: string;
  source: string;
  state: string;
  callbackResolvedAt: Date | null;
  unsubscribeStatus: string;
  unsubscribeAttemptedAt: Date | null;
  unsubscribeSucceededAt: Date | null;
  revokeStatus: string;
  revokeAttemptedAt: Date | null;
  revokeSucceededAt: Date | null;
  attempts: number;
  leaseId: string | null;
  leaseExpiresAt: Date | null;
  version: number;
  lastErrorCode: string | null;
  permanentFailureAt: Date | null;
  deadLetteredAt: Date | null;
  deadLetteredByUserId: string | null;
  terminalAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function connection(overrides: Record<string, unknown> = {}) {
  return {
    id: 'connection-a',
    tenantId: 'tenant-a',
    externalAccountId: '17841400000000000',
    displayName: 'autosale_store',
    status: 'ACTIVE',
    encryptedAccessToken: 'encrypted-token',
    credentialGenerationId: '11111111-1111-4111-8111-111111111111',
    tokenExpiresAt: new Date('2026-10-27T12:00:00.000Z'),
    lastVerifiedAt: now,
    lastErrorCode: null,
    disconnectedAt: null,
    ...overrides,
  };
}

function cleanupRow(overrides: Record<string, unknown> = {}): CleanupTestRow {
  return {
    id: 'cleanup-a',
    credentialGenerationId: '11111111-1111-4111-8111-111111111111',
    tenantId: 'tenant-a',
    externalAccountId: '17841400000000000',
    encryptedAccessToken: 'encrypted-token',
    source: 'DISCONNECT',
    state: 'REQUIRED',
    callbackResolvedAt: now,
    unsubscribeStatus: 'PENDING',
    unsubscribeAttemptedAt: null,
    unsubscribeSucceededAt: null,
    revokeStatus: 'PENDING',
    revokeAttemptedAt: null,
    revokeSucceededAt: null,
    attempts: 0,
    leaseId: null,
    leaseExpiresAt: null,
    version: 0,
    lastErrorCode: null,
    permanentFailureAt: null,
    deadLetteredAt: null,
    deadLetteredByUserId: null,
    terminalAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as CleanupTestRow;
}

function setup(nowFn: () => Date = () => now) {
  const findUnique = vi.fn();
  const upsert = vi.fn();
  const update = vi.fn();
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const updateManyAndReturn = vi.fn();
  const cleanupCreate = vi.fn().mockResolvedValue(cleanupRow());
  const cleanupFindUnique = vi.fn().mockResolvedValue(null);
  const cleanupFindFirst = vi.fn().mockResolvedValue(null);
  const cleanupFindMany = vi.fn().mockResolvedValue([]);
  const cleanupUpdateManyAndReturn = vi.fn().mockResolvedValue([cleanupRow()]);
  const cleanupUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
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
    instagramCredentialCleanup: {
      create: cleanupCreate,
      findUnique: cleanupFindUnique,
      findFirst: cleanupFindFirst,
      findMany: cleanupFindMany,
      updateMany: cleanupUpdateMany,
      updateManyAndReturn: cleanupUpdateManyAndReturn,
    },
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
    cleanupCreate, cleanupFindUnique, cleanupFindFirst, cleanupFindMany, cleanupUpdateManyAndReturn,
    cleanupUpdateMany,
    oauthStateUpdateMany, auditCreate,
    tenantFindUnique, tenantUpdateMany, membershipFindUnique,
  };
}

function installCleanupStore(
  mocks: Pick<ReturnType<typeof setup>, 'cleanupCreate' | 'cleanupFindUnique' | 'cleanupFindFirst' | 'cleanupFindMany' | 'cleanupUpdateMany' | 'cleanupUpdateManyAndReturn'>,
  initialRows: Array<Record<string, unknown>> = [],
) {
  const rows = initialRows.map((row, index) => cleanupRow({ id: `cleanup-${index + 1}`, ...row }));
  mocks.cleanupCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    const row = cleanupRow({ id: `cleanup-${rows.length + 1}`, ...data });
    rows.push(row);
    return row;
  });
  mocks.cleanupFindUnique.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
    rows.find((row) => cleanupMatches(row, where)) ?? null);
  mocks.cleanupFindFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
    rows.find((row) => cleanupMatches(row, where)) ?? null);
  mocks.cleanupFindMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
    rows.filter((row) => cleanupMatches(row, where)));
  mocks.cleanupUpdateMany.mockImplementation(async ({ where, data }: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }) => {
    const matching = rows.filter((row) => cleanupMatches(row, where));
    for (const row of matching) applyCleanupData(row, data);
    return { count: matching.length };
  });
  mocks.cleanupUpdateManyAndReturn.mockImplementation(async ({ where, data }: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }) => {
    const row = rows.find((candidate) => cleanupMatches(candidate, where));
    if (!row) return [];
    applyCleanupData(row, data);
    row.updatedAt = now;
    return [row];
  });
  return rows;
}

function cleanupMatches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(where)) {
    if (key === 'OR' && Array.isArray(expected)) {
      if (!expected.some((branch) => cleanupMatches(row, branch as Record<string, unknown>))) return false;
      continue;
    }
    if (typeof expected === 'object' && expected !== null && 'notIn' in expected) {
      if ((expected.notIn as unknown[]).includes(row[key])) return false;
      continue;
    }
    if (typeof expected === 'object' && expected !== null && 'lt' in expected) {
      const value = row[key];
      if (!(value instanceof Date) || value >= (expected.lt as Date)) return false;
      continue;
    }
    if (typeof expected === 'object' && expected !== null && 'gte' in expected) {
      if (typeof row[key] !== 'number' || row[key] < Number(expected.gte)) return false;
      continue;
    }
    if (typeof expected === 'object' && expected !== null && 'not' in expected) {
      if (row[key] === expected.not) return false;
      continue;
    }
    if (typeof expected === 'object' && expected !== null && 'in' in expected) {
      if (!(expected.in as unknown[]).includes(row[key])) return false;
      continue;
    }
    if (expected !== row[key]) return false;
  }
  return true;
}

function applyCleanupData(row: Record<string, unknown>, data: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'object' && value !== null && 'increment' in value) {
      row[key] = Number(row[key] ?? 0) + Number(value.increment);
    } else {
      row[key] = value;
    }
  }
}

describe('InstagramOAuthService', () => {
  it('disconnects the tenant bound to a provider-initiated deauthorization', async () => {
    const { service, findUnique } = setup();
    findUnique.mockResolvedValue({ tenantId: 'tenant-a', connectedByUserId: 'user-a' });
    const disconnect = vi.spyOn(service, 'disconnect').mockResolvedValue({} as never);

    await service.disconnectByExternalAccountId('17841400000000000');

    expect(disconnect).toHaveBeenCalledWith('tenant-a', 'user-a');
  });

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
        cleanupStatus: 'NONE',
        cleanupErrorCode: null,
        cleanupAbandonEligible: false,
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

  it('pre-arms one durable cleanup row for the credential generation before subscribing', async () => {
    const mocks = setup();
    const { service, meta, findUnique, upsert, update } = mocks;
    const cleanupRows = installCleanupStore(mocks);
    const order: string[] = [];
    findUnique.mockResolvedValue(null);
    upsert.mockImplementation(async (input: { create: Record<string, unknown> }) => {
      order.push('connection');
      return connection(input.create);
    });
    mocks.cleanupCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      order.push('cleanup');
      const row = cleanupRow({ id: 'cleanup-1', ...data });
      cleanupRows.push(row);
      return row;
    });
    meta.subscribe.mockImplementation(async () => {
      order.push('subscribe');
      expect(cleanupRows).toHaveLength(1);
      expect(cleanupRows[0]).toMatchObject({
        state: 'ARMED',
        credentialGenerationId: expect.any(String),
        encryptedAccessToken: expect.any(String),
      });
    });
    update.mockResolvedValue(connection());

    await service.completeCallback('authorization-code', 'raw-state');

    expect(order).toEqual(['connection', 'cleanup', 'subscribe']);
    expect(cleanupRows).toHaveLength(1);
    expect(cleanupRows[0]).toMatchObject({ state: 'CANCELLED', terminalAt: now });
  });

  it('does not subscribe when pre-arming the cleanup row fails', async () => {
    const { service, meta, findUnique, cleanupCreate } = setup();
    findUnique.mockResolvedValue(null);
    cleanupCreate.mockRejectedValue(new Error('database unavailable'));

    await expect(service.completeCallback('authorization-code', 'raw-state')).rejects.toThrow('Instagram connection failed');

    expect(meta.subscribe).not.toHaveBeenCalled();
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
    const mocks = setup();
    const { service, meta, upsert, tenantUpdateMany } = mocks;
    const cleanupRows = installCleanupStore(mocks);
    let releaseSubscribe: (() => void) | undefined;
    let subscribeStarted: (() => void) | undefined;
    const subscribeGate = new Promise<void>((resolve) => { releaseSubscribe = resolve; });
    const subscribeStartedPromise = new Promise<void>((resolve) => { subscribeStarted = resolve; });
    meta.subscribe.mockImplementation(async () => {
      subscribeStarted?.();
      await subscribeGate;
    });
    tenantUpdateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    const callback = service.completeCallback('authorization-code', 'raw-state');
    await subscribeStartedPromise;
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(cleanupRows[0]).toMatchObject({ state: 'ARMED', callbackResolvedAt: null });
    releaseSubscribe?.();

    await expect(callback).rejects.toThrow('Instagram connection failed');
    expect(meta.unsubscribe).toHaveBeenCalledWith('long-lived-token');
    expect(meta.revoke).toHaveBeenCalledWith('long-lived-token');
    expect(cleanupRows[0]).toMatchObject({ state: 'COMPLETED', callbackResolvedAt: now });
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
    const mocks = setup();
    const { service, meta, upsert, prisma } = mocks;
    const cleanupRows = installCleanupStore(mocks);
    meta.exchangeCode.mockImplementation(async () => ({
      accessToken: 'long-lived-token',
      expiresIn: 60,
      grantedScopes: ['instagram_business_basic', 'instagram_business_manage_messages'],
    }));
    let releaseSubscribe: (() => void) | undefined;
    let subscribeStarted: (() => void) | undefined;
    const subscribeGate = new Promise<void>((resolve) => { releaseSubscribe = resolve; });
    const subscribeStartedPromise = new Promise<void>((resolve) => { subscribeStarted = resolve; });
    meta.subscribe.mockImplementation(async () => {
      subscribeStarted?.();
      await subscribeGate;
    });
    prisma.tenantMembership.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    const callback = service.completeCallback('authorization-code', 'raw-state');
    await subscribeStartedPromise;
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(cleanupRows[0]).toMatchObject({ state: 'ARMED', callbackResolvedAt: null });
    releaseSubscribe?.();

    await expect(callback).rejects.toThrow('Instagram connection failed');
    expect(meta.unsubscribe).toHaveBeenCalledWith('long-lived-token');
    expect(meta.revoke).toHaveBeenCalledWith('long-lived-token');
    expect(cleanupRows[0]).toMatchObject({ state: 'COMPLETED', callbackResolvedAt: now });
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

  it('audits only safe provider diagnostics for a failed token exchange', async () => {
    const { service, meta, auditCreate } = setup();
    meta.exchangeCode.mockRejectedValue(new MetaInstagramError(500, 2, true, 33));

    await expect(service.completeCallback('authorization-code', 'raw-state')).rejects.toThrow('Instagram connection failed');

    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'INSTAGRAM_CALLBACK_FAILED',
        metadata: {
          errorCode: 'META_PROVIDER_FAILED',
          providerPhase: 'TOKEN_EXCHANGE',
          providerStatus: '500',
          providerCode: '2',
          providerSubcode: '33',
          providerTransient: 'true',
        },
      }),
    });
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
      cleanupStatus: 'NONE',
      cleanupErrorCode: null,
      cleanupAbandonEligible: false,
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
      cleanupStatus: 'NONE',
      cleanupErrorCode: null,
      cleanupAbandonEligible: false,
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
      cleanupStatus: 'NONE',
      cleanupErrorCode: null,
      cleanupAbandonEligible: false,
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
      cleanupStatus: 'NONE',
      cleanupErrorCode: null,
      cleanupAbandonEligible: false,
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

  it('reuses one generation row when disconnect wins locally while callback subscribe is in flight', async () => {
    const mocks = setup();
    const { service, meta, findUnique, tenantUpdateMany, upsert, update, auditCreate } = mocks;
    const cleanupRows = installCleanupStore(mocks);
    let currentAttempt: string | null = 'attempt-a';
    let currentConnection: Record<string, unknown> | null = null;
    let subscribed = false;
    let revoked = false;
    tenantUpdateMany.mockImplementation(async (input: {
      where: { id: string; instagramOAuthCurrentAttemptId?: string };
      data: { instagramOAuthCurrentAttemptId?: string | null };
    }) => {
      if ('instagramOAuthCurrentAttemptId' in input.where && input.where.instagramOAuthCurrentAttemptId !== currentAttempt) return { count: 0 };
      if ('instagramOAuthCurrentAttemptId' in input.data) currentAttempt = input.data.instagramOAuthCurrentAttemptId ?? null;
      return { count: 1 };
    });
    findUnique.mockImplementation(async (input: { where: { tenantId?: string; externalAccountId?: string } }) => {
      if (input.where.externalAccountId) return null;
      return currentConnection;
    });
    upsert.mockImplementation(async (input: { create: Record<string, unknown> }) => {
      currentConnection = connection(input.create);
      return currentConnection;
    });
    update.mockImplementation(async (input: { data: Record<string, unknown> }) => {
      currentConnection = connection({ ...currentConnection, ...input.data });
      return currentConnection;
    });
    let releaseSubscribe!: () => void;
    let subscribeStarted!: () => void;
    const started = new Promise<void>((resolve) => { subscribeStarted = resolve; });
    meta.subscribe.mockImplementation(async () => {
      subscribeStarted();
      await new Promise<void>((resolve) => { releaseSubscribe = resolve; });
      subscribed = true;
    });
    meta.unsubscribe.mockImplementation(async () => {
      subscribed = false;
    });
    meta.revoke.mockImplementation(async () => {
      if (revoked) throw new MetaInstagramError(400, 190);
      revoked = true;
    });

    const callback = service.completeCallback('authorization-code', 'raw-state');
    await started;
    await service.disconnect('tenant-a', 'user-a');
    expect(cleanupRows).toHaveLength(1);
    expect(cleanupRows[0]).toMatchObject({
      state: 'REQUIRED',
      callbackResolvedAt: null,
      terminalAt: null,
    });
    expect(meta.unsubscribe).not.toHaveBeenCalled();
    expect(meta.revoke).not.toHaveBeenCalled();

    releaseSubscribe();

    await expect(callback).rejects.toThrow('Instagram connection failed');
    expect(update.mock.calls.some(([input]) => input.data.status === 'ACTIVE')).toBe(false);
    expect(cleanupRows).toHaveLength(1);
    expect(cleanupRows[0]).toMatchObject({
      credentialGenerationId: expect.any(String),
      state: 'COMPLETED',
      terminalAt: expect.any(Date),
    });
    expect(meta.unsubscribe).toHaveBeenCalledTimes(1);
    expect(meta.revoke).toHaveBeenCalledTimes(1);
    expect(subscribed).toBe(false);
    expect(revoked).toBe(true);
    expect(auditCreate.mock.calls.map(([input]) => input.data.action)).toEqual(expect.arrayContaining([
      'INSTAGRAM_CREDENTIAL_CLEANUP_QUEUED',
      'INSTAGRAM_CREDENTIAL_CLEANUP_COMPLETED',
      'INSTAGRAM_CALLBACK_FAILED',
    ]));
    expect(JSON.stringify(auditCreate.mock.calls)).not.toMatch(/authorization-code|long-lived-token|encrypted-token/);
  });

  it('snapshots the exact token into durable cleanup and clears it from the connection before provider calls', async () => {
    const mocks = setup();
    const { service, findUnique, update, meta, auditCreate } = mocks;
    const cipher = new CredentialCipher(Buffer.alloc(32, 7));
    const encryptedAccessToken = cipher.encrypt('remote-token');
    const cleanupRows = installCleanupStore(mocks);
    const order: string[] = [];
    let currentConnection = connection({ encryptedAccessToken });
    findUnique.mockImplementation(async () => currentConnection);
    update
      .mockImplementationOnce(async (input: { data: { status: string; encryptedAccessToken: string | null } }) => {
        order.push(`local:${input.data.status}`);
        currentConnection = connection({ ...currentConnection, ...input.data });
        return currentConnection;
      });
    meta.unsubscribe.mockImplementation(async () => { order.push('unsubscribe'); throw new Error('provider unavailable'); });
    meta.revoke.mockImplementation(async () => { order.push('revoke'); });

    await expect(service.disconnect('tenant-a', 'user-a')).resolves.toMatchObject({
      status: 'DISCONNECTED',
      cleanupStatus: 'FAILED',
      cleanupErrorCode: 'META_DISCONNECT_CLEANUP_FAILED',
    });

    expect(cleanupRows).toHaveLength(1);
    expect(cleanupRows[0]).toMatchObject({
      tenantId: 'tenant-a',
      externalAccountId: '17841400000000000',
      encryptedAccessToken,
      unsubscribeStatus: 'FAILED',
      revokeStatus: 'PENDING',
      terminalAt: null,
      lastErrorCode: 'META_DISCONNECT_CLEANUP_FAILED',
    });
    expect(meta.unsubscribe).toHaveBeenCalledWith('remote-token');
    expect(meta.revoke).not.toHaveBeenCalled();
    expect(order).toEqual(['local:DISCONNECTED', 'unsubscribe']);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'DISCONNECTED',
        encryptedAccessToken: null,
        tokenExpiresAt: null,
        grantedScopes: null,
      }),
    }));
    expect(auditCreate.mock.calls.map(([input]) => input.data.action)).toEqual(expect.arrayContaining([
      'INSTAGRAM_CREDENTIAL_CLEANUP_QUEUED',
      'INSTAGRAM_CREDENTIAL_CLEANUP_FAILED',
    ]));
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-a',
        userId: 'user-a',
        action: 'INSTAGRAM_CREDENTIAL_CLEANUP_FAILED',
        result: 'FAILURE',
        metadata: { errorCode: 'META_DISCONNECT_CLEANUP_FAILED' },
      }),
    });
    expect(JSON.stringify(auditCreate.mock.calls)).not.toMatch(/remote-token|encryptedAccessToken|app-secret|provider unavailable/);
  });

  it('persists partial cleanup progress and retries only the remaining revoke operation', async () => {
    const mocks = setup();
    const { service, findUnique, meta } = mocks;
    const cipher = new CredentialCipher(Buffer.alloc(32, 7));
    const encryptedAccessToken = cipher.encrypt('remote-token');
    const cleanupRows = installCleanupStore(mocks, [{ encryptedAccessToken }]);
    findUnique.mockResolvedValue(connection({ status: 'DISCONNECTED', encryptedAccessToken: null, disconnectedAt: now }));
    meta.revoke
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValueOnce(undefined);

    await expect(service.retryCleanup('tenant-a', 'user-a')).resolves.toMatchObject({
      status: 'DISCONNECTED',
      cleanupStatus: 'FAILED',
      cleanupErrorCode: 'META_DISCONNECT_CLEANUP_FAILED',
    });

    expect(cleanupRows[0]).toMatchObject({
      unsubscribeStatus: 'SUCCEEDED',
      revokeStatus: 'FAILED',
      terminalAt: null,
    });
    expect(meta.unsubscribe).toHaveBeenCalledTimes(1);
    expect(meta.revoke).toHaveBeenCalledTimes(1);

    await expect(service.retryCleanup('tenant-a', 'user-a')).resolves.toMatchObject({
      status: 'DISCONNECTED',
      cleanupStatus: 'NONE',
      cleanupErrorCode: null,
    });

    expect(meta.unsubscribe).toHaveBeenCalledTimes(1);
    expect(meta.revoke).toHaveBeenCalledTimes(2);
    expect(cleanupRows[0]).toMatchObject({
      unsubscribeStatus: 'SUCCEEDED',
      revokeStatus: 'SUCCEEDED',
      lastErrorCode: null,
    });
    expect(cleanupRows[0]?.terminalAt).toBeInstanceOf(Date);
  });

  it('preserves partial cleanup progress when disconnect reclaims the same generation', async () => {
    const mocks = setup();
    const { service, findUnique, update, meta } = mocks;
    const cipher = new CredentialCipher(Buffer.alloc(32, 7));
    const cleanupRows = installCleanupStore(mocks, [{
      encryptedAccessToken: cipher.encrypt('remote-token'),
      unsubscribeStatus: 'SUCCEEDED',
      unsubscribeSucceededAt: now,
      revokeStatus: 'PENDING',
      callbackResolvedAt: now,
      state: 'REQUIRED',
    }]);
    let currentConnection = connection({
      status: 'ACTIVE',
      encryptedAccessToken: cleanupRows[0]?.encryptedAccessToken,
      credentialGenerationId: cleanupRows[0]?.credentialGenerationId,
    });
    findUnique.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      if (where.externalAccountId) return null;
      return currentConnection;
    });
    update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      currentConnection = connection({ ...currentConnection, ...data });
      return currentConnection;
    });

    await expect(service.disconnect('tenant-a', 'user-a')).resolves.toMatchObject({
      status: 'DISCONNECTED',
      cleanupStatus: 'NONE',
    });

    expect(meta.unsubscribe).not.toHaveBeenCalled();
    expect(meta.revoke).toHaveBeenCalledWith('remote-token');
    expect(cleanupRows[0]).toMatchObject({
      unsubscribeStatus: 'SUCCEEDED',
      revokeStatus: 'SUCCEEDED',
      state: 'COMPLETED',
    });
  });

  it('preserves succeeded unsubscribe progress when decrypting the remaining revoke credential fails', async () => {
    const mocks = setup();
    const { service, findUnique, meta } = mocks;
    const cleanupRows = installCleanupStore(mocks, [{
      encryptedAccessToken: 'not-a-valid-ciphertext',
      unsubscribeStatus: 'SUCCEEDED',
      unsubscribeSucceededAt: now,
      revokeStatus: 'PENDING',
    }]);
    findUnique.mockResolvedValue(connection({ status: 'DISCONNECTED', encryptedAccessToken: null, disconnectedAt: now }));

    await service.retryCleanup('tenant-a', 'user-a');

    expect(cleanupRows[0]).toMatchObject({
      unsubscribeStatus: 'SUCCEEDED',
      revokeStatus: 'FAILED',
      lastErrorCode: 'META_DISCONNECT_CLEANUP_FAILED',
    });
    expect(meta.unsubscribe).not.toHaveBeenCalled();
    expect(meta.revoke).not.toHaveBeenCalled();
  });

  it('normalizes a verified revoked-token response while replaying revoke after a lost success CAS', async () => {
    let clock = now;
    const mocks = setup(() => clock);
    const { service, findUnique, meta, cleanupUpdateManyAndReturn } = mocks;
    const cipher = new CredentialCipher(Buffer.alloc(32, 7));
    const cleanupRows = installCleanupStore(mocks, [{
      encryptedAccessToken: cipher.encrypt('remote-token'),
      unsubscribeStatus: 'SUCCEEDED',
      unsubscribeSucceededAt: now,
    }]);
    findUnique.mockResolvedValue(connection({ status: 'DISCONNECTED', encryptedAccessToken: null, disconnectedAt: now }));
    let revoked = false;
    meta.revoke.mockImplementation(async () => {
      if (revoked) throw new MetaInstagramError(400, 190);
      revoked = true;
    });
    const durableUpdate = cleanupUpdateManyAndReturn.getMockImplementation()!;
    let loseFirstSuccess = true;
    cleanupUpdateManyAndReturn.mockImplementation(async (input: { data: Record<string, unknown> }) => {
      if (loseFirstSuccess && input.data.revokeStatus === 'SUCCEEDED') {
        loseFirstSuccess = false;
        return [];
      }
      return durableUpdate(input);
    });

    await service.retryCleanup('tenant-a', 'user-a');
    expect(cleanupRows[0]).toMatchObject({ revokeStatus: 'PENDING', terminalAt: null });

    clock = new Date(now.getTime() + 5 * 60 * 1000 + 1);
    await service.retryCleanup('tenant-a', 'user-a');

    expect(meta.revoke).toHaveBeenCalledTimes(2);
    expect(cleanupRows[0]).toMatchObject({ revokeStatus: 'SUCCEEDED', state: 'COMPLETED' });
    expect(cleanupRows[0]?.terminalAt).toBeInstanceOf(Date);
  });

  it('does not normalize a transient invalid-token revoke response as success', async () => {
    const mocks = setup();
    const { service, findUnique, meta } = mocks;
    const cipher = new CredentialCipher(Buffer.alloc(32, 7));
    const cleanupRows = installCleanupStore(mocks, [{
      encryptedAccessToken: cipher.encrypt('remote-token'),
      unsubscribeStatus: 'SUCCEEDED',
      unsubscribeSucceededAt: now,
    }]);
    findUnique.mockResolvedValue(connection({ status: 'DISCONNECTED', encryptedAccessToken: null, disconnectedAt: now }));
    meta.revoke.mockRejectedValue(new MetaInstagramError(400, 190, true, 463));

    await expect(service.retryCleanup('tenant-a', 'user-a')).resolves.toMatchObject({
      cleanupStatus: 'FAILED',
      cleanupErrorCode: 'META_DISCONNECT_CLEANUP_FAILED',
    });
    expect(cleanupRows[0]).toMatchObject({
      unsubscribeStatus: 'SUCCEEDED',
      revokeStatus: 'FAILED',
      permanentFailureAt: null,
      terminalAt: null,
    });
  });

  it('recovers a stale pre-armed callback cleanup and clears the matching pending local credential', async () => {
    const staleCreatedAt = new Date(now.getTime() - 5 * 60 * 1000 - 1);
    const mocks = setup();
    const { service, findUnique, updateMany, meta } = mocks;
    const cipher = new CredentialCipher(Buffer.alloc(32, 7));
    const encryptedAccessToken = cipher.encrypt('remote-token');
    const cleanupRows = installCleanupStore(mocks, [{
      encryptedAccessToken,
      source: 'CALLBACK_PREARM',
      state: 'ARMED',
      callbackResolvedAt: null,
      createdAt: staleCreatedAt,
    }]);
    let currentConnection = connection({
      status: 'ERROR',
      encryptedAccessToken,
      credentialGenerationId: cleanupRows[0]?.credentialGenerationId,
      lastErrorCode: null,
    });
    findUnique.mockImplementation(async () => currentConnection);
    updateMany.mockImplementation(async (input: { data: Record<string, unknown> }) => {
      currentConnection = connection({ ...currentConnection, ...input.data });
      return { count: 1 };
    });

    await expect(service.retryCleanup('tenant-a', 'user-a')).resolves.toMatchObject({
      status: 'ERROR',
      cleanupStatus: 'NONE',
      cleanupErrorCode: null,
    });

    expect(meta.unsubscribe).toHaveBeenCalledWith('remote-token');
    expect(meta.revoke).toHaveBeenCalledWith('remote-token');
    expect(cleanupRows[0]).toMatchObject({
      source: 'OPERATOR_RECOVERY',
      state: 'COMPLETED',
      callbackResolvedAt: now,
      terminalAt: now,
    });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId: 'tenant-a',
        credentialGenerationId: { in: [cleanupRows[0]?.credentialGenerationId] },
        status: { not: 'ACTIVE' },
      }),
      data: expect.objectContaining({
        encryptedAccessToken: null,
        tokenExpiresAt: null,
        grantedScopes: null,
        lastErrorCode: 'META_ACTIVATION_FAILED',
      }),
    }));
  });

  it('replays unsubscribe when the provider returns documented success again after a lost success CAS', async () => {
    let clock = now;
    const mocks = setup(() => clock);
    const { service, findUnique, meta, cleanupUpdateManyAndReturn } = mocks;
    const cipher = new CredentialCipher(Buffer.alloc(32, 7));
    const cleanupRows = installCleanupStore(mocks, [{
      encryptedAccessToken: cipher.encrypt('remote-token'),
    }]);
    findUnique.mockResolvedValue(connection({ status: 'DISCONNECTED', encryptedAccessToken: null, disconnectedAt: now }));
    meta.unsubscribe.mockResolvedValue(undefined);
    const durableUpdate = cleanupUpdateManyAndReturn.getMockImplementation()!;
    let loseFirstSuccess = true;
    cleanupUpdateManyAndReturn.mockImplementation(async (input: { data: Record<string, unknown> }) => {
      if (loseFirstSuccess && input.data.unsubscribeStatus === 'SUCCEEDED') {
        loseFirstSuccess = false;
        return [];
      }
      return durableUpdate(input);
    });

    await service.retryCleanup('tenant-a', 'user-a');
    expect(cleanupRows[0]).toMatchObject({ unsubscribeStatus: 'PENDING', revokeStatus: 'PENDING', terminalAt: null });

    clock = new Date(now.getTime() + 5 * 60 * 1000 + 1);
    await service.retryCleanup('tenant-a', 'user-a');

    expect(meta.unsubscribe).toHaveBeenCalledTimes(2);
    expect(meta.revoke).toHaveBeenCalledTimes(1);
    expect(cleanupRows[0]).toMatchObject({
      unsubscribeStatus: 'SUCCEEDED',
      revokeStatus: 'SUCCEEDED',
      state: 'COMPLETED',
    });
    expect(cleanupRows[0]?.terminalAt).toBeInstanceOf(Date);
  });

  it('keeps a coded transient Meta cleanup failure retryable', async () => {
    const mocks = setup();
    const { service, findUnique, meta } = mocks;
    const cipher = new CredentialCipher(Buffer.alloc(32, 7));
    const cleanupRows = installCleanupStore(mocks, [{ encryptedAccessToken: cipher.encrypt('remote-token') }]);
    findUnique.mockResolvedValue(connection({ status: 'DISCONNECTED', encryptedAccessToken: null, disconnectedAt: now }));
    meta.unsubscribe.mockRejectedValue(new MetaInstagramError(403, 10, true, 2207051));

    await expect(service.retryCleanup('tenant-a', 'user-a')).resolves.toMatchObject({
      cleanupStatus: 'FAILED',
      cleanupErrorCode: 'META_DISCONNECT_CLEANUP_FAILED',
    });
    expect(cleanupRows[0]).toMatchObject({
      unsubscribeStatus: 'FAILED',
      permanentFailureAt: null,
      terminalAt: null,
    });
  });

  it('keeps an unknown coded 4xx Meta cleanup failure retryable', async () => {
    const mocks = setup();
    const { service, findUnique, meta } = mocks;
    const cipher = new CredentialCipher(Buffer.alloc(32, 7));
    const cleanupRows = installCleanupStore(mocks, [{ encryptedAccessToken: cipher.encrypt('remote-token') }]);
    findUnique.mockResolvedValue(connection({ status: 'DISCONNECTED', encryptedAccessToken: null, disconnectedAt: now }));
    meta.unsubscribe.mockRejectedValue(new MetaInstagramError(400, 2, false, 2207051));

    await expect(service.retryCleanup('tenant-a', 'user-a')).resolves.toMatchObject({
      cleanupStatus: 'FAILED',
      cleanupErrorCode: 'META_DISCONNECT_CLEANUP_FAILED',
    });
    expect(cleanupRows[0]).toMatchObject({
      unsubscribeStatus: 'FAILED',
      permanentFailureAt: null,
      terminalAt: null,
    });
  });

  it('does not treat invalid credentials as unsubscribe success when absence is unverified', async () => {
    const mocks = setup();
    const { service, findUnique, meta } = mocks;
    const cipher = new CredentialCipher(Buffer.alloc(32, 7));
    const cleanupRows = installCleanupStore(mocks, [{
      encryptedAccessToken: cipher.encrypt('remote-token'),
    }]);
    findUnique.mockResolvedValue(connection({ status: 'DISCONNECTED', encryptedAccessToken: null, disconnectedAt: now }));
    meta.unsubscribe.mockRejectedValue(new MetaInstagramError(400, 190));

    await expect(service.retryCleanup('tenant-a', 'user-a')).resolves.toMatchObject({
      cleanupStatus: 'FAILED',
      cleanupErrorCode: 'META_DISCONNECT_CLEANUP_FAILED',
    });

    expect(meta.revoke).not.toHaveBeenCalled();
    expect(cleanupRows[0]).toMatchObject({
      unsubscribeStatus: 'FAILED',
      revokeStatus: 'PENDING',
      permanentFailureAt: null,
      terminalAt: null,
    });
  });

  it('keeps an ambiguous provider client error retryable rather than dead-lettering it', async () => {
    const mocks = setup();
    const { service, findUnique, meta } = mocks;
    const cipher = new CredentialCipher(Buffer.alloc(32, 7));
    const cleanupRows = installCleanupStore(mocks, [{ encryptedAccessToken: cipher.encrypt('remote-token') }]);
    findUnique.mockResolvedValue(connection({ status: 'DISCONNECTED', encryptedAccessToken: null, disconnectedAt: now }));
    meta.unsubscribe.mockRejectedValue(new MetaInstagramError(400, null));

    await expect(service.retryCleanup('tenant-a', 'user-a')).resolves.toMatchObject({
      cleanupStatus: 'FAILED',
      cleanupErrorCode: 'META_DISCONNECT_CLEANUP_FAILED',
    });
    expect(cleanupRows[0]).toMatchObject({
      unsubscribeStatus: 'FAILED',
      permanentFailureAt: null,
      terminalAt: null,
    });
    await expect(service.deadLetterCleanup('tenant-a', 'user-a', 'ABANDON_REMOTE_CLEANUP')).rejects.toThrow('Instagram connection failed');
    expect(cleanupRows[0]?.terminalAt).toBeNull();
  });

  it('lets the owner abandon an unknown retryable cleanup only after three failed attempts', async () => {
    const mocks = setup();
    const { service, findUnique, updateMany, meta, auditCreate } = mocks;
    const cipher = new CredentialCipher(Buffer.alloc(32, 7));
    const cleanupRows = installCleanupStore(mocks, [{ encryptedAccessToken: cipher.encrypt('remote-token') }]);
    const newerConnection = connection({
      status: 'ACTIVE',
      externalAccountId: '17841499999999999',
      credentialGenerationId: '22222222-2222-4222-8222-222222222222',
      encryptedAccessToken: cipher.encrypt('new-remote-token'),
    });
    findUnique.mockResolvedValue(newerConnection);
    updateMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
      where.status === 'DISCONNECTED' ? { count: 0 } : { count: 1 });
    meta.unsubscribe.mockRejectedValue(new MetaInstagramError(400, 2, false, 2207051));

    for (const attempts of [1, 2]) {
      await expect(service.retryCleanup('tenant-a', 'user-a')).resolves.toMatchObject({
        cleanupStatus: 'FAILED',
        cleanupAbandonEligible: false,
      });
      expect(cleanupRows[0]?.attempts).toBe(attempts);
      await expect(service.deadLetterCleanup('tenant-a', 'user-a', 'ABANDON_REMOTE_CLEANUP'))
        .rejects.toThrow('Instagram connection failed');
      expect(cleanupRows[0]?.terminalAt).toBeNull();
    }

    await expect(service.retryCleanup('tenant-a', 'user-a')).resolves.toMatchObject({
      status: 'ACTIVE',
      accountId: '17841499999999999',
      cleanupStatus: 'FAILED',
      cleanupAbandonEligible: true,
    });

    await expect(service.deadLetterCleanup('tenant-a', 'user-a', 'ABANDON_REMOTE_CLEANUP'))
      .resolves.toMatchObject({
        status: 'ACTIVE',
        accountId: '17841499999999999',
        cleanupStatus: 'NONE',
        cleanupAbandonEligible: false,
      });
    expect(cleanupRows[0]).toMatchObject({
      state: 'DEAD_LETTER',
      attempts: 3,
      lastErrorCode: 'META_CLEANUP_DEAD_LETTERED',
      deadLetteredAt: now,
      deadLetteredByUserId: 'user-a',
      terminalAt: now,
    });
    expect(newerConnection.lastErrorCode).toBeNull();
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'INSTAGRAM_CREDENTIAL_CLEANUP_DEAD_LETTERED',
        userId: 'user-a',
        metadata: { errorCode: 'META_DISCONNECT_CLEANUP_FAILED' },
      }),
    });
    expect(JSON.stringify(auditCreate.mock.calls)).not.toMatch(/remote-token|2207051|provider/);
  });

  it('does not permit abandoning a retryable cleanup while a lease is active', async () => {
    const mocks = setup();
    const { service, findUnique } = mocks;
    const cipher = new CredentialCipher(Buffer.alloc(32, 7));
    const cleanupRows = installCleanupStore(mocks, [{
      encryptedAccessToken: cipher.encrypt('remote-token'),
      unsubscribeStatus: 'FAILED',
      attempts: 3,
      lastErrorCode: 'META_DISCONNECT_CLEANUP_FAILED',
      leaseId: 'lease-a',
      leaseExpiresAt: new Date(now.getTime() + 60_000),
    }]);
    findUnique.mockResolvedValue(connection({ status: 'DISCONNECTED', encryptedAccessToken: null, disconnectedAt: now }));

    await expect(service.deadLetterCleanup('tenant-a', 'user-a', 'ABANDON_REMOTE_CLEANUP'))
      .rejects.toThrow('Instagram connection failed');
    expect(cleanupRows[0]).toMatchObject({
      state: 'REQUIRED',
      leaseId: 'lease-a',
      terminalAt: null,
    });
    await expect(service.getSummary('tenant-a')).resolves.toMatchObject({
      cleanupStatus: 'FAILED',
      cleanupAbandonEligible: false,
    });
  });

  it('requires an explicit audited owner action before dead-lettering a permanent provider failure', async () => {
    const mocks = setup();
    const { service, findUnique, updateMany, meta, auditCreate } = mocks;
    const cipher = new CredentialCipher(Buffer.alloc(32, 7));
    const cleanupRows = installCleanupStore(mocks, [{ encryptedAccessToken: cipher.encrypt('remote-token') }]);
    let currentConnection = connection({ status: 'DISCONNECTED', encryptedAccessToken: null, disconnectedAt: now });
    findUnique.mockImplementation(async () => currentConnection);
    updateMany.mockImplementation(async (input: { data: Record<string, unknown> }) => {
      currentConnection = connection({ ...currentConnection, ...input.data });
      return { count: 1 };
    });
    meta.unsubscribe.mockRejectedValue(new MetaInstagramError(403, 10, false, 200));

    await expect(service.retryCleanup('tenant-a', 'user-a')).resolves.toMatchObject({
      cleanupStatus: 'FAILED',
      cleanupErrorCode: 'META_CLEANUP_PERMANENT_FAILURE',
    });
    expect(cleanupRows[0]).toMatchObject({ permanentFailureAt: now, terminalAt: null });

    await expect(service.deadLetterCleanup('tenant-a', 'user-a', 'WRONG_CONFIRMATION')).rejects.toThrow('Instagram connection failed');
    expect(cleanupRows[0]?.terminalAt).toBeNull();
    await expect(service.deadLetterCleanup('tenant-a', 'user-a', 'ABANDON_REMOTE_CLEANUP')).resolves.toMatchObject({
      cleanupStatus: 'NONE',
      lastErrorCode: 'META_CLEANUP_DEAD_LETTERED',
    });
    expect(cleanupRows[0]).toMatchObject({
      state: 'DEAD_LETTER',
      deadLetteredAt: now,
      deadLetteredByUserId: 'user-a',
      terminalAt: now,
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'INSTAGRAM_CREDENTIAL_CLEANUP_DEAD_LETTERED',
        userId: 'user-a',
        metadata: { errorCode: 'META_CLEANUP_PERMANENT_FAILURE' },
      }),
    });
    expect(JSON.stringify(auditCreate.mock.calls)).not.toMatch(/remote-token|encryptedAccessToken/);
  });

  it('leases cleanup rows so overlapping retries do not duplicate provider operations', async () => {
    const mocks = setup();
    const { service, findUnique, meta } = mocks;
    const cipher = new CredentialCipher(Buffer.alloc(32, 7));
    installCleanupStore(mocks, [{ encryptedAccessToken: cipher.encrypt('remote-token') }]);
    findUnique.mockResolvedValue(connection({ status: 'DISCONNECTED', encryptedAccessToken: null, disconnectedAt: now }));
    let cleanupStarted: (() => void) | undefined;
    let releaseCleanup: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { cleanupStarted = resolve; });
    meta.unsubscribe.mockImplementation(async () => {
      cleanupStarted?.();
      await new Promise<void>((resolve) => { releaseCleanup = resolve; });
    });

    const first = service.retryCleanup('tenant-a', 'user-a');
    await Promise.race([started, new Promise<void>((resolve) => setTimeout(resolve, 50))]);
    const second = service.retryCleanup('tenant-a', 'user-a');
    await second;
    releaseCleanup?.();
    await first;

    expect(meta.unsubscribe).toHaveBeenCalledTimes(1);
    expect(meta.revoke).toHaveBeenCalledTimes(1);
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

  it('cleans an older pending credential without touching a newer active connection', async () => {
    const mocks = setup();
    const { service, findUnique, update, updateMany, meta } = mocks;
    const cipher = new CredentialCipher(Buffer.alloc(32, 7));
    const oldCiphertext = cipher.encrypt('old-remote-token');
    installCleanupStore(mocks, [{ encryptedAccessToken: oldCiphertext }]);
    findUnique.mockResolvedValue(connection({
      externalAccountId: '17841499999999999',
      displayName: 'new_store',
      status: 'ACTIVE',
      encryptedAccessToken: cipher.encrypt('new-remote-token'),
      lastErrorCode: null,
    }));

    await expect(service.retryCleanup('tenant-a', 'user-a')).resolves.toMatchObject({
      status: 'ACTIVE',
      accountId: '17841499999999999',
      username: 'new_store',
      lastErrorCode: null,
      cleanupStatus: 'NONE',
    });

    expect(meta.unsubscribe).toHaveBeenCalledWith('old-remote-token');
    expect(meta.revoke).toHaveBeenCalledWith('old-remote-token');
    expect(update).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'DISCONNECTED' }),
    }));
  });
});
