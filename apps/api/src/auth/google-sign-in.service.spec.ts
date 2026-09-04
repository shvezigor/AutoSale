import type { PrismaClient } from '@autosale/database';
import type { GoogleSignInClientPort } from '@autosale/integrations';
import { describe, expect, it, vi } from 'vitest';

import type { GoogleSignInStateService } from './google-sign-in-state.service.js';
import { GoogleSignInService } from './google-sign-in.service.js';
import type { SessionService } from './session.service.js';

const now = new Date('2026-09-03T12:00:00.000Z');
const identity = { subject: 'google-subject', email: 'owner@example.com', name: 'Owner' };
const user = {
  id: '10000000-0000-4000-8000-000000000001', email: identity.email, name: identity.name,
  platformRole: 'USER' as const, status: 'ACTIVE', emailVerifiedAt: now,
  memberships: [{ tenantId: '20000000-0000-4000-8000-000000000001', role: 'OWNER' as const, status: 'ACTIVE' }],
};

function setup(overrides: Record<string, unknown> = {}) {
  const prisma = {
    googleIdentity: {
      findUnique: vi.fn(async () => null), create: vi.fn(async () => ({})), update: vi.fn(async () => ({})),
    },
    user: { findUnique: vi.fn(async () => null), create: vi.fn(async () => user) },
    tenant: { create: vi.fn(async () => ({ id: user.memberships[0]!.tenantId })) },
    tenantMembership: { create: vi.fn(async () => user.memberships[0]) },
    securityAuditLog: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(prisma)),
    ...overrides,
  };
  const provider: GoogleSignInClientPort = {
    getAuthorizationUrl: vi.fn(() => 'https://accounts.google.com/o/oauth2/v2/auth'),
    exchangeAndVerify: vi.fn(async () => identity),
  };
  const state = {
    createAttempt: vi.fn(async () => ({ state: 'raw-state' })),
    consumeState: vi.fn(async () => ({ attemptId: 'attempt-1', returnPath: '/catalogue' })),
    armOnboarding: vi.fn(async () => ({ grant: 'raw-grant', expiresAt: new Date(now.getTime() + 60_000) })),
    readOnboarding: vi.fn(async () => ({ email: identity.email, name: identity.name })),
    consumeOnboarding: vi.fn(async () => ({ ...identity, attemptId: 'attempt-1', returnPath: '/catalogue' })),
  } as unknown as GoogleSignInStateService;
  const sessions = { create: vi.fn(async () => ({ rawToken: 'session-token', expiresAt: new Date(now.getTime() + 60_000) })) } as unknown as SessionService;
  const service = new GoogleSignInService(prisma as unknown as PrismaClient, provider, state, sessions, true, () => now);
  return { service, prisma, provider, state, sessions };
}

describe('GoogleSignInService', () => {
  it('updates a linked identity and creates a session', async () => {
    const fixture = setup();
    vi.mocked(fixture.prisma.googleIdentity.findUnique).mockResolvedValue({ user } as never);

    const result = await fixture.service.completeCallback({ state: 'state', code: 'code' }, {});

    expect(result).toMatchObject({ kind: 'SESSION', returnPath: '/catalogue', sessionResult: { rawToken: 'session-token' } });
    expect(fixture.prisma.googleIdentity.update).toHaveBeenCalledWith({ where: { googleSubject: identity.subject }, data: { lastUsedAt: now } });
    expect(fixture.sessions.create).toHaveBeenCalledWith(user.id, user.memberships[0]!.tenantId, {});
  });

  it('auto-links a new subject only to an active matching verified email and audits it', async () => {
    const fixture = setup();
    vi.mocked(fixture.prisma.user.findUnique).mockResolvedValue(user as never);

    await fixture.service.completeCallback({ state: 'state', code: 'code' }, { ipPrefix: '127.0.0.0/24' });

    expect(fixture.prisma.googleIdentity.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: user.id, googleSubject: identity.subject }) });
    expect(fixture.prisma.securityAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'GOOGLE_IDENTITY_AUTO_LINKED' }) });
    expect(JSON.stringify(vi.mocked(fixture.prisma.securityAuditLog.create).mock.calls)).not.toContain(identity.email);
  });

  it('returns onboarding for a new email without creating an account or Google Sheets connection', async () => {
    const fixture = setup();

    const result = await fixture.service.completeCallback({ state: 'state', code: 'code' }, {});

    expect(result).toMatchObject({ kind: 'ONBOARDING', grant: 'raw-grant' });
    expect(fixture.state.armOnboarding).toHaveBeenCalledWith('attempt-1', identity);
    expect(fixture.prisma.user.create).not.toHaveBeenCalled();
    expect(fixture.prisma.tenant.create).not.toHaveBeenCalled();
    expect((fixture.prisma as Record<string, unknown>).googleConnection).toBeUndefined();
  });

  it('creates one active owner workspace from an onboarding grant and signs in', async () => {
    const fixture = setup();

    const result = await fixture.service.completeOnboarding({ grant: 'grant', tenantName: 'My Store' }, {});

    expect(fixture.prisma.user.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      email: identity.email, passwordHash: null, status: 'ACTIVE', emailVerifiedAt: now,
    }) });
    expect(fixture.prisma.tenantMembership.create).toHaveBeenCalledWith({ data: expect.objectContaining({ role: 'OWNER', status: 'ACTIVE' }) });
    expect(fixture.prisma.googleIdentity.create).toHaveBeenCalledWith({ data: expect.objectContaining({ googleSubject: identity.subject }) });
    expect(result).toMatchObject({ returnPath: '/catalogue', sessionResult: { rawToken: 'session-token' } });
  });

  it('fails neutrally when a verified-email auto-link conflicts', async () => {
    const fixture = setup();
    vi.mocked(fixture.prisma.user.findUnique).mockResolvedValue(user as never);
    vi.mocked(fixture.prisma.googleIdentity.create).mockRejectedValue(new Error('unique constraint'));

    await expect(fixture.service.completeCallback({ state: 'state', code: 'code' }, {}))
      .rejects.toThrow('Unable to complete Google Sign-In');
  });

  it('allows only one concurrent onboarding completion to create a workspace', async () => {
    const fixture = setup();
    vi.mocked(fixture.state.consumeOnboarding)
      .mockResolvedValueOnce({ ...identity, attemptId: 'attempt-1', returnPath: '/catalogue' })
      .mockRejectedValueOnce(new Error('already used'));

    const results = await Promise.allSettled([
      fixture.service.completeOnboarding({ grant: 'same-grant', tenantName: 'Store' }, {}),
      fixture.service.completeOnboarding({ grant: 'same-grant', tenantName: 'Store' }, {}),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(fixture.prisma.tenant.create).toHaveBeenCalledTimes(1);
  });

  it('does not mutate accounts when disabled or when the provider is denied', async () => {
    const disabled = setup();
    const disabledService = new GoogleSignInService(disabled.prisma as unknown as PrismaClient, disabled.provider, disabled.state, disabled.sessions, false, () => now);
    await expect(disabledService.start()).rejects.toThrow('Google Sign-In is unavailable');
    await expect(disabled.service.completeCallback({ state: 'state', denied: true }, {})).rejects.toThrow('Google Sign-In was cancelled');
    expect(disabled.prisma.user.create).not.toHaveBeenCalled();
    expect(disabled.provider.exchangeAndVerify).not.toHaveBeenCalled();
  });
});
