import { describe, expect, it, vi } from 'vitest';

import { AuthController } from './auth.controller.js';

describe('AuthController', () => {
  it('sets an HttpOnly SameSite session cookie after login', async () => {
    const auth = { login: vi.fn(async () => ({
      rawToken: 'raw-session-token', expiresAt: new Date('2026-09-26T00:00:00Z'),
      session: { userId: '10000000-0000-4000-8000-000000000001', email: 'owner@example.com', name: 'Owner', platformRole: 'USER', tenantId: null, membershipRole: null },
    })) };
    const response = { cookie: vi.fn() };
    const controller = new AuthController(auth as never, {} as never, { cookieName: 'autosale_session', production: true });
    const session = await controller.login({ email: 'owner@example.com', password: 'correct horse battery' }, { headers: {}, socket: {} } as never, response as never);

    expect(session.email).toBe('owner@example.com');
    expect(response.cookie).toHaveBeenCalledWith('autosale_session', 'raw-session-token', expect.objectContaining({
      httpOnly: true, sameSite: 'lax', secure: true, path: '/',
    }));
  });
});
