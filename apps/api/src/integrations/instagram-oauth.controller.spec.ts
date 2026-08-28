import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTH_ACCESS_KEY, SKIP_CSRF_KEY } from '../auth/auth.decorators.js';
import { InstagramOAuthController } from './instagram-oauth.controller.js';
import { InstagramOAuthService } from './instagram-oauth.service.js';

describe('InstagramOAuthController', () => {
  const principal = {
    userId: 'owner-a',
    email: 'owner@example.com',
    name: 'Owner',
    platformRole: 'USER',
    tenantId: 'tenant-a',
    membershipRole: 'OWNER',
    sessionId: 'session-a',
  } as const;
  let app: INestApplication | undefined;
  const getSummary = vi.fn();
  const connect = vi.fn();
  const completeCallback = vi.fn();
  const disconnect = vi.fn();

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

    const moduleRef = await Test.createTestingModule({
      controllers: [InstagramOAuthController],
      providers: [{
        provide: InstagramOAuthService,
        useValue: { getSummary, connect, completeCallback, disconnect },
      }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use((req: { principal?: unknown }, _res: unknown, next: () => void) => {
      req.principal = principal;
      next();
    });
    await app.init();
  });

  afterEach(async () => app?.close());

  it('requires manager membership for summary and owner membership for mutations', () => {
    expect(Reflect.getMetadata(AUTH_ACCESS_KEY, InstagramOAuthController.prototype.getSummary)).toBe('TENANT_MANAGER');
    expect(Reflect.getMetadata(AUTH_ACCESS_KEY, InstagramOAuthController.prototype.connect)).toBe('TENANT_OWNER');
    expect(Reflect.getMetadata(AUTH_ACCESS_KEY, InstagramOAuthController.prototype.disconnect)).toBe('TENANT_OWNER');
  });

  it('makes only the callback public and CSRF-exempt', () => {
    expect(Reflect.getMetadata(AUTH_ACCESS_KEY, InstagramOAuthController.prototype.callback)).toBe('PUBLIC');
    expect(Reflect.getMetadata(SKIP_CSRF_KEY, InstagramOAuthController.prototype.callback)).toBe(true);
    expect(Reflect.getMetadata(SKIP_CSRF_KEY, InstagramOAuthController.prototype.connect)).toBeUndefined();
    expect(Reflect.getMetadata(SKIP_CSRF_KEY, InstagramOAuthController.prototype.disconnect)).toBeUndefined();
  });

  it('uses only the authenticated tenant for summary, connect, and disconnect', async () => {
    await request(app!.getHttpServer()).get('/api/integrations/instagram').expect(200);
    await request(app!.getHttpServer())
      .post('/api/integrations/instagram/connect')
      .send({ returnPath: '/settings?tab=instagram' })
      .expect(201);
    await request(app!.getHttpServer()).post('/api/integrations/instagram/disconnect').expect(201);

    expect(getSummary).toHaveBeenCalledWith('tenant-a');
    expect(connect).toHaveBeenCalledWith('tenant-a', 'owner-a', '/settings?tab=instagram');
    expect(disconnect).toHaveBeenCalledWith('tenant-a');
  });

  it('uses state-bound callback data without consulting a session and preserves an existing query', async () => {
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
