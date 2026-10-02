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
import { FacebookOAuthController } from './facebook-oauth.controller.js';
import { FacebookOAuthService } from './facebook-oauth.service.js';

describe('FacebookOAuthController', () => {
  const owner: AuthPrincipal = {
    userId: 'owner-a', email: 'owner@example.invalid', name: 'Owner', platformRole: 'USER',
    tenantId: 'tenant-a', membershipRole: 'OWNER', locale: 'uk', avatarUrl: null, sessionId: 'owner-session',
  };
  const manager: AuthPrincipal = { ...owner, userId: 'manager-a', membershipRole: 'MANAGER', sessionId: 'manager-session' };
  const csrf = new CsrfService('p'.repeat(32));
  const authorize = vi.fn();
  const getSummary = vi.fn();
  const completeCallback = vi.fn();
  const getPageCandidates = vi.fn();
  const selectPage = vi.fn();
  const disconnect = vi.fn();
  const retryCleanup = vi.fn();
  let app: INestApplication | undefined;

  beforeEach(async () => {
    authorize.mockReset().mockResolvedValue({ authorizationUrl: 'https://www.facebook.com/v24.0/dialog/oauth' });
    getSummary.mockReset().mockResolvedValue({ status: 'NOT_CONNECTED' });
    completeCallback.mockReset().mockResolvedValue({
      kind: 'PAGE_SELECTION_REQUIRED',
      returnPath: '/settings?tab=social',
      attemptId: '11111111-1111-4111-8111-111111111111',
      pages: [{ pageId: 'page-1', pageName: 'Fictional Page' }],
    });
    getPageCandidates.mockReset().mockResolvedValue({ attemptId: '11111111-1111-4111-8111-111111111111', pages: [] });
    selectPage.mockReset().mockResolvedValue({ status: 'ACTIVE' });
    disconnect.mockReset().mockResolvedValue({ status: 'DISCONNECTED' });
    retryCleanup.mockReset().mockResolvedValue({ status: 'DISCONNECTED' });
    const resolve = vi.fn().mockImplementation(async (token: string) => token === 'owner-token'
      ? owner
      : token === 'manager-token' ? manager : null);

    const moduleRef = await Test.createTestingModule({
      controllers: [FacebookOAuthController],
      providers: [
        { provide: FacebookOAuthService, useValue: { authorize, getSummary, completeCallback, getPageCandidates, selectPage, disconnect, retryCleanup } },
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

  it('allows managers to read but only owners to mutate the connection', async () => {
    await request(app!.getHttpServer()).get('/api/integrations/facebook').expect(401);
    await request(app!.getHttpServer()).get('/api/integrations/facebook').set('Cookie', cookie('manager-token')).expect(200);
    await request(app!.getHttpServer())
      .post('/api/integrations/facebook/authorize')
      .set('Cookie', cookie('manager-token')).set(csrfHeader(manager)).send({}).expect(403);
    await request(app!.getHttpServer())
      .post('/api/integrations/facebook/authorize')
      .set('Cookie', cookie('owner-token')).send({}).expect(403);
    await request(app!.getHttpServer())
      .post('/api/integrations/facebook/authorize')
      .set('Cookie', cookie('owner-token')).set(csrfHeader(owner)).send({ returnPath: '/settings?tab=social' }).expect(201);

    expect(authorize).toHaveBeenCalledWith('tenant-a', 'owner-a', '/settings?tab=social');
  });

  it('keeps candidate tokens server-side and exposes Page selection only to the owner', async () => {
    await request(app!.getHttpServer())
      .get('/api/integrations/facebook/selection')
      .query({ attemptId: '11111111-1111-4111-8111-111111111111' })
      .set('Cookie', cookie('manager-token')).expect(403);
    await request(app!.getHttpServer())
      .post('/api/integrations/facebook/selection')
      .set('Cookie', cookie('owner-token')).set(csrfHeader(owner))
      .send({ attemptId: '11111111-1111-4111-8111-111111111111', pageId: 'page-1' })
      .expect(201);
    expect(selectPage).toHaveBeenCalledWith('tenant-a', 'owner-a', {
      attemptId: '11111111-1111-4111-8111-111111111111', pageId: 'page-1',
    });
  });

  it('allows the callback without a session and redirects to Page selection', async () => {
    await request(app!.getHttpServer())
      .get('/api/integrations/facebook/callback')
      .query({ code: 'authorization-code', state: 'raw-state' })
      .expect(302)
      .expect('Location', '/settings?tab=social&facebook=select-page&attemptId=11111111-1111-4111-8111-111111111111');
    expect(completeCallback).toHaveBeenCalledWith('authorization-code', 'raw-state', false);
  });

  it('uses a single safe callback error redirect', async () => {
    completeCallback.mockRejectedValue(new Error('provider body with secret-token'));
    const response = await request(app!.getHttpServer())
      .get('/api/integrations/facebook/callback')
      .query({ error: 'access_denied', error_description: 'secret-token', state: 'raw-state' })
      .expect(302);
    expect(response.headers.location).toBe('/settings?tab=social&facebook=error');
    expect(response.headers.location).not.toContain('secret-token');
  });

  it('protects disconnect and cleanup retry with owner role and CSRF', async () => {
    await request(app!.getHttpServer()).delete('/api/integrations/facebook')
      .set('Cookie', cookie('owner-token')).set(csrfHeader(owner)).expect(200);
    await request(app!.getHttpServer()).post('/api/integrations/facebook/cleanup/retry')
      .set('Cookie', cookie('owner-token')).set(csrfHeader(owner)).expect(201);
    expect(disconnect).toHaveBeenCalledWith('tenant-a', 'owner-a');
    expect(retryCleanup).toHaveBeenCalledWith('tenant-a', 'owner-a');
  });
});
