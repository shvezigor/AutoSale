import type { AuthPrincipal } from '@autosale/contracts/auth';
import { describe, expect, it } from 'vitest';

import { AuthGuard, decideAccess } from './auth.guard.js';

const owner: AuthPrincipal = { userId: 'u', email: 'o@example.com', platformRole: 'USER', tenantId: 't', membershipRole: 'OWNER', sessionId: 's' };
const manager: AuthPrincipal = { ...owner, membershipRole: 'MANAGER' };
const admin: AuthPrincipal = { ...owner, platformRole: 'PLATFORM_ADMIN', tenantId: null, membershipRole: null };

describe('decideAccess', () => {
  it('keeps platform admin outside tenant data policies', () => {
    expect(decideAccess(admin, 'TENANT_MANAGER')).toBe(false);
    expect(decideAccess(admin, 'PLATFORM_ADMIN')).toBe(true);
  });

  it('enforces owner and manager role hierarchy', () => {
    expect(decideAccess(owner, 'TENANT_OWNER')).toBe(true);
    expect(decideAccess(manager, 'TENANT_OWNER')).toBe(false);
    expect(decideAccess(manager, 'TENANT_MANAGER')).toBe(true);
    expect(decideAccess(null, 'PUBLIC')).toBe(true);
  });
});

describe('AuthGuard', () => {
  it('resolves the cookie and attaches the authenticated principal', async () => {
    const request: { method: string; headers: { cookie: string }; principal?: AuthPrincipal } = { method: 'GET', headers: { cookie: 'autosale_session=raw-token' } };
    const reflector = { getAllAndOverride: (key: string) => key === 'autosale:auth-access' ? 'TENANT_MANAGER' : undefined };
    const sessions = { resolve: async (raw: string) => raw === 'raw-token' ? manager : null };
    const context = {
      getHandler: () => 'handler', getClass: () => 'controller',
      switchToHttp: () => ({ getRequest: () => request }),
    };
    const guard = new AuthGuard(reflector as never, sessions as never, { cookieName: 'autosale_session', production: false }, { verify: () => true } as never);
    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    expect(request.principal).toBe(manager);
  });

  it('blocks a cookie-authenticated mutation without a valid CSRF token', async () => {
    const request = { method: 'POST', headers: { cookie: 'autosale_session=raw-token' } };
    const reflector = { getAllAndOverride: (key: string) => key === 'autosale:auth-access' ? 'TENANT_MANAGER' : undefined };
    const sessions = { resolve: async () => manager };
    const context = { getHandler: () => 'handler', getClass: () => 'controller', switchToHttp: () => ({ getRequest: () => request }) };
    const guard = new AuthGuard(reflector as never, sessions as never, { cookieName: 'autosale_session', production: false }, { verify: () => false } as never);
    await expect(guard.canActivate(context as never)).rejects.toMatchObject({ status: 403 });
  });

  it('allows the authenticated CSRF bootstrap endpoint without an existing CSRF token', async () => {
    const request = { method: 'POST', headers: { cookie: 'autosale_session=raw-token' } };
    const reflector = { getAllAndOverride: (key: string) => key === 'autosale:skip-csrf' ? true : 'AUTHENTICATED' };
    const sessions = { resolve: async () => manager };
    const context = { getHandler: () => 'handler', getClass: () => 'controller', switchToHttp: () => ({ getRequest: () => request }) };
    const guard = new AuthGuard(reflector as never, sessions as never, { cookieName: 'autosale_session', production: false }, { verify: () => false } as never);

    await expect(guard.canActivate(context as never)).resolves.toBe(true);
  });
});
