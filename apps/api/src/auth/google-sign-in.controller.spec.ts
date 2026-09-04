import { describe, expect, it, vi } from 'vitest';

import { GoogleSignInController } from './google-sign-in.controller.js';

const sessionResult = {
  rawToken: 'raw-session', expiresAt: new Date('2026-10-01T00:00:00Z'),
  session: { userId: '10000000-0000-4000-8000-000000000001', email: 'owner@example.com', name: 'Owner', platformRole: 'USER', tenantId: '20000000-0000-4000-8000-000000000001', membershipRole: 'OWNER' },
};

function setup() {
  const google = {
    start: vi.fn(async () => ({ authorizationUrl: 'https://accounts.google.com/auth' })),
    completeCallback: vi.fn(async () => ({ kind: 'SESSION', sessionResult, returnPath: '/catalogue' })),
    onboardingSummary: vi.fn(async () => ({ email: 'owner@example.com', name: 'Owner' })),
    completeOnboarding: vi.fn(async () => ({ sessionResult, returnPath: '/conversations' })),
  };
  const rateLimit = { consume: vi.fn(async () => undefined) };
  const controller = new GoogleSignInController(google as never, rateLimit as never, {
    cookieName: 'autosale_session', onboardingCookieName: 'autosale_google_onboarding', production: true,
  });
  return { controller, google, rateLimit };
}

describe('GoogleSignInController', () => {
  it('starts sign-in with an IP rate limit and returns only the authorization URL', async () => {
    const fixture = setup();
    const result = await fixture.controller.start({ returnPath: '/catalogue' }, { ip: '127.0.0.1', headers: {}, socket: {} } as never);
    expect(fixture.rateLimit.consume).toHaveBeenCalledWith('google-sign-in', '127.0.0.1', '127.0.0.1', 10, 60);
    expect(result).toEqual({ authorizationUrl: 'https://accounts.google.com/auth' });
  });

  it('sets the normal session cookie and redirects after an existing-user callback', async () => {
    const fixture = setup();
    const response = { cookie: vi.fn(), redirect: vi.fn() };
    await fixture.controller.callback({ state: 'state', code: 'code' }, { headers: {}, socket: {} } as never, response as never);
    expect(response.cookie).toHaveBeenCalledWith('autosale_session', 'raw-session', expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'lax' }));
    expect(response.redirect).toHaveBeenCalledWith('/catalogue');
  });

  it('sets only the onboarding cookie for a new user', async () => {
    const fixture = setup();
    fixture.google.completeCallback.mockResolvedValueOnce({ kind: 'ONBOARDING', grant: 'raw-grant', expiresAt: new Date('2026-09-03T12:15:00Z') } as never);
    const response = { cookie: vi.fn(), redirect: vi.fn() };
    await fixture.controller.callback({ state: 'state', code: 'code' }, { headers: {}, socket: {} } as never, response as never);
    expect(response.cookie).toHaveBeenCalledWith('autosale_google_onboarding', 'raw-grant', expect.objectContaining({ httpOnly: true, sameSite: 'lax' }));
    expect(response.cookie).not.toHaveBeenCalledWith('autosale_session', expect.anything(), expect.anything());
    expect(response.redirect).toHaveBeenCalledWith('/onboarding/google');
  });

  it('reads onboarding from an HttpOnly cookie and never returns the grant', async () => {
    const fixture = setup();
    const result = await fixture.controller.onboarding({ headers: { cookie: 'autosale_google_onboarding=secret-grant' } } as never);
    expect(fixture.google.onboardingSummary).toHaveBeenCalledWith('secret-grant');
    expect(result).toEqual({ email: 'owner@example.com', name: 'Owner' });
    expect(JSON.stringify(result)).not.toContain('secret-grant');
  });

  it('completes onboarding, rotates to a session cookie, and clears the onboarding cookie', async () => {
    const fixture = setup();
    const response = { cookie: vi.fn(), clearCookie: vi.fn() };
    const result = await fixture.controller.completeOnboarding(
      { tenantName: 'Store' }, { headers: { cookie: 'autosale_google_onboarding=grant' }, socket: {} } as never, response as never,
    );
    expect(fixture.google.completeOnboarding).toHaveBeenCalledWith({ grant: 'grant', tenantName: 'Store' }, expect.any(Object));
    expect(response.cookie).toHaveBeenCalledWith('autosale_session', 'raw-session', expect.any(Object));
    expect(response.clearCookie).toHaveBeenCalledWith('autosale_google_onboarding', expect.any(Object));
    expect(result).toEqual(sessionResult.session);
  });
});
