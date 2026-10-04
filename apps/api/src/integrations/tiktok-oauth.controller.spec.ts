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
import { TikTokOAuthController } from './tiktok-oauth.controller.js';
import { TikTokOAuthService } from './tiktok-oauth.service.js';

describe('TikTokOAuthController', () => {
  const owner: AuthPrincipal = {
    userId: 'owner-a', email: 'owner@example.invalid', name: 'Owner', platformRole: 'USER',
    tenantId: 'tenant-a', membershipRole: 'OWNER', locale: 'uk', avatarUrl: null, sessionId: 'owner-session',
  };
  const manager: AuthPrincipal = { ...owner, userId: 'manager-a', membershipRole: 'MANAGER', sessionId: 'manager-session' };
  const csrf = new CsrfService('p'.repeat(32));
  const authorize = vi.fn();
  const getSummary = vi.fn();
  const completeCallback = vi.fn();
  const disconnect = vi.fn();
  const retryCleanup = vi.fn();
  let app: INestApplication | undefined;

  beforeEach(async () => {
    authorize.mockReset().mockResolvedValue({ authorizationUrl: 'https://business-api.tiktok.com/portal/auth?state=x' });
    getSummary.mockReset().mockResolvedValue({ status: 'NOT_CONNECTED' });
    completeCallback.mockReset().mockResolvedValue({ returnPath: '/settings?tab=social', summary: { status: 'INBOUND_ONLY' } });
    disconnect.mockReset().mockResolvedValue({ status: 'DISCONNECTED' });
    retryCleanup.mockReset().mockResolvedValue({ status: 'DISCONNECTED' });
    const resolve = vi.fn().mockImplementation(async (token: string) => token === 'owner-token'
      ? owner
      : token === 'manager-token' ? manager : null);
    const moduleRef = await Test.createTestingModule({
      controllers: [TikTokOAuthController],
      providers: [
        { provide: TikTokOAuthService, useValue: { authorize, getSummary, completeCallback, disconnect, retryCleanup } },
        { provide: SessionService, useValue: { resolve } },
        { provide: CsrfService, useValue: csrf },
        { provide: AUTH_HTTP_CONFIG, useValue: { cookieName: 'autosale_session', production: false } },
        {
          provide: AuthGuard,
          useFactory: () => new AuthGuard(
            new Reflector(), { resolve } as never,
            { cookieName: 'autosale_session', production: false }, csrf,
          ),
        },
        { provide: APP_GUARD, useExisting: AuthGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => app?.close());
  const cookie = (token: string) => `autosale_session=${token}`;
  const csrfHeader = (principal: AuthPrincipal) => ({ 'x-csrf-token': csrf.issue(principal.sessionId) });

  it('allows managers to read but only owners to start or remove a connection', async () => {
    await request(app!.getHttpServer()).get('/api/integrations/tiktok').expect(401);
    await request(app!.getHttpServer()).get('/api/integrations/tiktok').set('Cookie', cookie('manager-token')).expect(200);
    await request(app!.getHttpServer()).post('/api/integrations/tiktok/authorize')
      .set('Cookie', cookie('manager-token')).set(csrfHeader(manager)).send({}).expect(403);
    await request(app!.getHttpServer()).post('/api/integrations/tiktok/authorize')
      .set('Cookie', cookie('owner-token')).set(csrfHeader(owner))
      .send({ returnPath: '/settings?tab=social' }).expect(201);
    expect(authorize).toHaveBeenCalledWith('tenant-a', 'owner-a', '/settings?tab=social');
  });

  it('accepts the public provider callback and redirects without leaking provider errors', async () => {
    await request(app!.getHttpServer()).get('/api/integrations/tiktok/callback/')
      .query({ code: 'authorization-code', state: 'raw-state' })
      .expect(302).expect('Location', '/settings?tab=social&tiktok=connected');
    expect(completeCallback).toHaveBeenCalledWith('authorization-code', 'raw-state');

    completeCallback.mockRejectedValueOnce(new Error('provider secret-token'));
    const response = await request(app!.getHttpServer()).get('/api/integrations/tiktok/callback/')
      .query({ error: 'access_denied', error_description: 'secret-token', state: 'raw-state' }).expect(302);
    expect(response.headers.location).toBe('/settings?tab=social&tiktok=error');
  });

  it('protects disconnect and cleanup retry with owner role and CSRF', async () => {
    await request(app!.getHttpServer()).delete('/api/integrations/tiktok/connection')
      .set('Cookie', cookie('owner-token')).set(csrfHeader(owner)).expect(200);
    await request(app!.getHttpServer()).post('/api/integrations/tiktok/cleanup/retry')
      .set('Cookie', cookie('owner-token')).set(csrfHeader(owner)).expect(201);
    expect(disconnect).toHaveBeenCalledWith('tenant-a', 'owner-a');
    expect(retryCleanup).toHaveBeenCalledWith('tenant-a', 'owner-a');
  });
});
