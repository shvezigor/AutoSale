import type { AuthPrincipal } from '@autosale/contracts/auth';
import type { INestApplication } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTH_HTTP_CONFIG } from '../auth/auth.controller.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { CsrfService } from '../auth/csrf.service.js';
import { SessionService } from '../auth/session.service.js';
import { GoogleOAuthController } from './google-oauth.controller.js';
import { GoogleOAuthService } from './google-oauth.service.js';
import { GoogleCredentialCleanupService } from './google-credential-cleanup.service.js';

describe('GoogleOAuthController', () => {
  const owner: AuthPrincipal = { userId: 'owner', email: 'o@example.com', name: 'Owner', platformRole: 'USER', tenantId: 'tenant', membershipRole: 'OWNER', sessionId: 'owner-session' };
  const manager: AuthPrincipal = { ...owner, userId: 'manager', membershipRole: 'MANAGER', sessionId: 'manager-session' };
  const csrf = new CsrfService('p'.repeat(32));
  const start = vi.fn();
  const summary = vi.fn();
  const complete = vi.fn();
  const disconnect = vi.fn();
  const getAccessToken = vi.fn();
  let app: INestApplication;

  beforeEach(async () => {
    start.mockReset().mockResolvedValue({ authorizationUrl: 'https://accounts.google.com/auth' });
    summary.mockReset().mockResolvedValue({ status: 'ACTIVE', email: 'o@example.com' });
    complete.mockReset().mockResolvedValue({ returnPath: '/settings?tab=google', summary: { status: 'ACTIVE' } });
    disconnect.mockReset().mockResolvedValue({ status: 'DISCONNECTED' });
    getAccessToken.mockReset().mockResolvedValue('short-lived-token');
    const resolve = vi.fn(async (token: string) => token === 'owner' ? owner : token === 'manager' ? manager : null);
    const module = await Test.createTestingModule({
      controllers: [GoogleOAuthController],
      providers: [
        { provide: GoogleOAuthService, useValue: { start, summary, complete, getAccessToken } },
        { provide: GoogleCredentialCleanupService, useValue: { disconnect } },
        { provide: SessionService, useValue: { resolve } },
        { provide: CsrfService, useValue: csrf },
        { provide: AUTH_HTTP_CONFIG, useValue: { cookieName: 'autosale_session', production: false } },
        { provide: AuthGuard, useFactory: () => new AuthGuard(new Reflector(), { resolve } as never, { cookieName: 'autosale_session', production: false }, csrf) },
        { provide: APP_GUARD, useExisting: AuthGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => app.close());

  it('allows a manager to read status but only an owner with CSRF to connect', async () => {
    await request(app.getHttpServer()).get('/api/integrations/google').set('Cookie', 'autosale_session=manager').expect(200);
    expect(summary).toHaveBeenCalledWith('tenant', false);
    await request(app.getHttpServer()).post('/api/integrations/google/connect').set('Cookie', 'autosale_session=manager').set('x-csrf-token', csrf.issue(manager.sessionId)).expect(403);
    await request(app.getHttpServer()).post('/api/integrations/google/connect').set('Cookie', 'autosale_session=owner').expect(403);
    await request(app.getHttpServer()).post('/api/integrations/google/connect').set('Cookie', 'autosale_session=owner').set('x-csrf-token', csrf.issue(owner.sessionId)).send({ returnPath: '/settings?tab=google' }).expect(201);
    expect(start).toHaveBeenCalledWith('tenant', 'owner', '/settings?tab=google');
  });

  it('handles a public callback and never reflects provider error text', async () => {
    await request(app.getHttpServer()).get('/api/integrations/google/callback').query({ code: 'code', state: 'state' }).expect(302).expect('Location', '/settings?tab=google&google=connected');
    complete.mockRejectedValue(new Error('secret provider description'));
    await request(app.getHttpServer()).get('/api/integrations/google/callback').query({ error: 'access_denied', error_description: 'secret' }).expect(302).expect('Location', '/settings?google=error');
  });

  it('returns a non-cacheable short-lived Picker token only to the owner', async () => {
    await request(app.getHttpServer()).get('/api/integrations/google/access-token').set('Cookie', 'autosale_session=manager').expect(403);
    const response = await request(app.getHttpServer()).get('/api/integrations/google/access-token').set('Cookie', 'autosale_session=owner').expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({ accessToken: 'short-lived-token' });
  });
});
