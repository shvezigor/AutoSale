import { describe, expect, it, vi } from 'vitest';

import { AuthController } from './auth.controller.js';

describe('AuthController', () => {
  it('sets an HttpOnly SameSite session cookie after login', async () => {
    const auth = { login: vi.fn(async () => ({
      rawToken: 'raw-session-token', expiresAt: new Date('2026-09-26T00:00:00Z'),
      session: { userId: '10000000-0000-4000-8000-000000000001', email: 'owner@example.com', name: 'Owner', platformRole: 'USER', tenantId: null, membershipRole: null },
    })) };
    const response = { cookie: vi.fn() };
    const controller = new AuthController(auth as never, {} as never, { cookieName: 'autosale_session', production: true }, {} as never, { consume: vi.fn() } as never);
    const session = await controller.login({ email: 'owner@example.com', password: 'correct horse battery' }, { headers: {}, socket: {} } as never, response as never);

    expect(session.email).toBe('owner@example.com');
    expect(response.cookie).toHaveBeenCalledWith('autosale_session', 'raw-session-token', expect.objectContaining({
      httpOnly: true, sameSite: 'lax', secure: true, path: '/',
    }));
  });

  it('issues a CSRF token bound to the authenticated session', () => {
    const csrf = { issue: vi.fn(() => 'csrf-token') };
    const controller = new AuthController({} as never, {} as never, { cookieName: 'autosale_session', production: true }, csrf as never, {} as never);

    expect(controller.csrf({ sessionId: 'session-1' } as never)).toEqual({ token: 'csrf-token' });
    expect(csrf.issue).toHaveBeenCalledWith('session-1');
  });

  it('rate limits login by request IP and normalized email before authentication', async () => {
    const consume = vi.fn(async () => undefined);
    const auth = { login: vi.fn(async () => ({ rawToken: 'raw', expiresAt: new Date(), session: {} })) };
    const controller = new AuthController(auth as never, {} as never, { cookieName: 'session', production: false }, {} as never, { consume } as never);

    await controller.login(
      { email: ' OWNER@Example.com ', password: 'correct horse battery' },
      { ip: '127.0.0.1', headers: {}, socket: {} } as never,
      { cookie: vi.fn() } as never,
    );

    expect(consume).toHaveBeenCalledWith('login', '127.0.0.1', 'owner@example.com', 5, 60);
    expect(auth.login).toHaveBeenCalledOnce();
  });

  it('rate limits registration and password recovery endpoints', async () => {
    const consume = vi.fn(async () => undefined);
    const auth = {
      register: vi.fn(async () => ({ accepted: true })),
      requestPasswordReset: vi.fn(async () => ({ accepted: true })),
      resetPassword: vi.fn(async () => ({ reset: true })),
    };
    const controller = new AuthController(auth as never, {} as never, { cookieName: 'session', production: false }, {} as never, { consume } as never);
    const request = { ip: '127.0.0.1', headers: {}, socket: {} } as never;

    await controller.register({ email: 'New@Example.com', password: 'correct horse battery', name: 'Owner', tenantName: 'Store' }, request);
    await controller.forgotPassword({ email: 'New@Example.com' }, request);
    await controller.resetPassword({ token: 'x'.repeat(20), password: 'new correct horse battery' }, request);

    expect(consume).toHaveBeenNthCalledWith(1, 'register', '127.0.0.1', 'new@example.com', 3, 3600);
    expect(consume).toHaveBeenNthCalledWith(2, 'forgot-password', '127.0.0.1', 'new@example.com', 5, 3600);
    expect(consume).toHaveBeenNthCalledWith(3, 'reset-password', '127.0.0.1', expect.any(String), 5, 3600);
  });
});
