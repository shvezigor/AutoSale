import type { AuthPrincipal } from '@autosale/contracts/auth';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_GUARD, Reflector } from '@nestjs/core';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTH_HTTP_CONFIG } from '../auth/auth.controller.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { CsrfService } from '../auth/csrf.service.js';
import { SessionService } from '../auth/session.service.js';
import { InstagramOAuthController } from './instagram-oauth.controller.js';
import { InstagramOAuthService } from './instagram-oauth.service.js';

describe('InstagramOAuthController', () => {
  const owner: AuthPrincipal = {
    userId: 'owner-a',
    email: 'owner@example.com',
    name: 'Owner',
    platformRole: 'USER',
    tenantId: 'tenant-a',
    membershipRole: 'OWNER',
    sessionId: 'session-owner',
  };
  const manager: AuthPrincipal = { ...owner, userId: 'manager-a', membershipRole: 'MANAGER', sessionId: 'session-manager' };
  let app: INestApplication | undefined;
  const getSummary = vi.fn();
  const connect = vi.fn();
  const completeCallback = vi.fn();
  const disconnect = vi.fn();
  const resolve = vi.fn();
  const csrf = new CsrfService('p'.repeat(32));

  const cookie = (token: string) => `autosale_session=${token}`;
  const csrfHeader = (principal: AuthPrincipal) => ({ 'x-csrf-token': csrf.issue(principal.sessionId) });

  beforeEach(async () => {
    getSummary.mockReset().mockResolvedValue({
      status: 'ACTIVE',
      accountId: '17841400000000000',
      username: 'autosale_store',
      tokenExpiresAt: null,
      lastVerifiedAt: '2026-08-28T12:00:00.000Z',
      lastErrorCode: null,
    });
    connect.mockReset().mockResolvedValue({ authorizationUrl: 'https://www.instagram.com/oauth/authorize?state=opaque' });
    completeCallback.mockReset().mockResolvedValue({
      returnPath: '/settings?tab=instagram',
      summary: { status: 'ACTIVE' },
    });
    disconnect.mockReset().mockResolvedValue({ status: 'DISCONNECTED' });
    resolve.mockReset().mockImplementation(async (token: string) => {
      if (token === 'owner-token') return owner;
      if (token === 'manager-token') return manager;
      return null;
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [InstagramOAuthController],
      providers: [
        { provide: InstagramOAuthService, useValue: { getSummary, connect, completeCallback, disconnect } },
        { provide: SessionService, useValue: { resolve } },
        { provide: CsrfService, useValue: csrf },
        { provide: AUTH_HTTP_CONFIG, useValue: { cookieName: 'autosale_session', production: false } },
        {
          provide: AuthGuard,
          useFactory: () => new AuthGuard(
            new Reflector(),
            { resolve } as never,
            { cookieName: 'autosale_session', production: false },
            csrf,
          ),
        },
        { provide: APP_GUARD, useExisting: AuthGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => app?.close());

  it('rejects an unauthenticated summary request while allowing a tenant manager to read it', async () => {
    await request(app!.getHttpServer()).get('/api/integrations/instagram').expect(401);
    await request(app!.getHttpServer())
      .get('/api/integrations/instagram')
      .set('Cookie', cookie('manager-token'))
      .expect(200);

    expect(getSummary).toHaveBeenCalledWith('tenant-a');
  });

  it('allows only an owner with a valid CSRF token to mutate the connection', async () => {
    await request(app!.getHttpServer())
      .post('/api/integrations/instagram/connect')
      .set('Cookie', cookie('manager-token'))
      .set(csrfHeader(manager))
      .send({ returnPath: '/settings?tab=instagram' })
      .expect(403);
    await request(app!.getHttpServer())
      .post('/api/integrations/instagram/connect')
      .set('Cookie', cookie('owner-token'))
      .send({ returnPath: '/settings?tab=instagram' })
      .expect(403);
    await request(app!.getHttpServer())
      .post('/api/integrations/instagram/connect')
      .set('Cookie', cookie('owner-token'))
      .set(csrfHeader(owner))
      .send({ returnPath: '/settings?tab=instagram' })
      .expect(201);
    await request(app!.getHttpServer())
      .post('/api/integrations/instagram/disconnect')
      .set('Cookie', cookie('owner-token'))
      .set(csrfHeader(owner))
      .expect(201);

    expect(connect).toHaveBeenCalledWith('tenant-a', 'owner-a', '/settings?tab=instagram');
    expect(disconnect).toHaveBeenCalledWith('tenant-a');
  });

  it('allows the callback without a session or CSRF token and redirects from state-bound data', async () => {
    await request(app!.getHttpServer())
      .get('/api/integrations/instagram/callback')
      .query({ code: 'authorization-code', state: 'raw-state' })
      .expect(302)
      .expect('Location', '/settings?tab=instagram&instagram=connected');

    expect(completeCallback).toHaveBeenCalledWith('authorization-code', 'raw-state');
  });

  it('redirects every invalid or provider-failed callback to one safe local error URL', async () => {
    completeCallback.mockRejectedValue(new Error('provider description contains secret-token'));

    const response = await request(app!.getHttpServer())
      .get('/api/integrations/instagram/callback')
      .query({ error: 'access_denied', error_description: 'secret-token', state: 'raw-state' })
      .expect(302);

    expect(response.headers.location).toBe('/settings?instagram=error');
    expect(response.headers.location).not.toContain('secret-token');
    expect(completeCallback).toHaveBeenCalledWith(undefined, 'raw-state');
  });
});
