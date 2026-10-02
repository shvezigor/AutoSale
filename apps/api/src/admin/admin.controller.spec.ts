import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTH_HTTP_CONFIG } from '../auth/auth.controller.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { CsrfService } from '../auth/csrf.service.js';
import { SessionService } from '../auth/session.service.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { AdminStepUpService } from './admin-step-up.service.js';
import { TenantLifecycleService } from './tenant-lifecycle.service.js';

const principal = {
  userId: '11111111-1111-4111-8111-111111111111', email: 'admin@example.test', name: 'Fictional Admin',
  platformRole: 'PLATFORM_ADMIN', tenantId: null, membershipRole: null, locale: 'uk', avatarUrl: null,
  sessionId: '22222222-2222-4222-8222-222222222222',
} as const;
const tenantId = '33333333-3333-4333-8333-333333333333';
const requestId = '44444444-4444-4444-8444-444444444444';
const idempotencyKey = '55555555-5555-4555-8555-555555555555';

describe('AdminController', () => {
  it('exposes aggregate tenants and tenant status controls only', async () => {
    const service = { listTenants: vi.fn().mockResolvedValue([]), setTenantStatus: vi.fn().mockResolvedValue({ status: 'BLOCKED', revokedSessions: 2 }) };
    const controller = new AdminController(service as never, {} as never, {} as never);

    await expect(controller.listTenants()).resolves.toEqual([]);
    await expect(controller.blockTenant('tenant-1')).resolves.toEqual({ status: 'BLOCKED', revokedSessions: 2 });
    expect(service.setTenantStatus).toHaveBeenCalledWith('tenant-1', 'BLOCKED');
  });

  it('returns a session-bound reauthentication token without echoing the password', async () => {
    const stepUp = {
      issue: vi.fn().mockResolvedValue('signed-step-up-token'),
      expiresAt: vi.fn().mockReturnValue('2026-10-02T09:05:00.000Z'),
    };
    const controller = new AdminController({} as never, stepUp as never, {} as never);

    await expect(controller.reauthenticate(principal, {
      currentPassword: 'fictional secure password', purpose: 'TENANT_DELETE_REQUEST',
    })).resolves.toEqual({ stepUpToken: 'signed-step-up-token', expiresAt: '2026-10-02T09:05:00.000Z' });
    expect(stepUp.issue).toHaveBeenCalledWith(
      principal.userId, principal.sessionId, 'fictional secure password', 'TENANT_DELETE_REQUEST',
    );
  });

  it('passes validated routing headers to deletion orchestration', async () => {
    const lifecycle = { createDeletion: vi.fn().mockResolvedValue({ id: requestId }) };
    const controller = new AdminController({} as never, {} as never, lifecycle as never);

    await expect(controller.createLifecycleDeletion(
      principal, tenantId, idempotencyKey, 'step-up', { reasonCode: 'ADMINISTRATIVE_TEST' },
    )).resolves.toEqual({ id: requestId });
    expect(lifecycle.createDeletion).toHaveBeenCalledWith(
      principal, tenantId, { reasonCode: 'ADMINISTRATIVE_TEST' }, idempotencyKey, 'step-up',
    );
  });

  it('rejects malformed lifecycle bodies and idempotency keys before orchestration', () => {
    const lifecycle = { createExport: vi.fn() };
    const controller = new AdminController({} as never, {} as never, lifecycle as never);

    expect(() => controller.createLifecycleExport(principal, tenantId, 'not-a-uuid', { reasonCode: 'FREE_TEXT' }))
      .toThrow();
    expect(lifecycle.createExport).not.toHaveBeenCalled();
  });
});

describe('AdminController HTTP security', () => {
  let app: INestApplication;
  const csrf = new CsrfService('p'.repeat(32));
  const createDeletion = vi.fn();
  const regularUser = { ...principal, userId: '66666666-6666-4666-8666-666666666666', platformRole: 'USER' as const };

  beforeEach(async () => {
    createDeletion.mockReset().mockImplementation((...args: unknown[]) => {
      if (!args[4]) throw new UnauthorizedException('ADMIN_REAUTH_REQUIRED');
      return { id: requestId };
    });
    const resolve = vi.fn(async (token: string) => token === 'admin' ? principal : token === 'user' ? regularUser : null);
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: AdminService, useValue: { listTenants: vi.fn(), setTenantStatus: vi.fn() } },
        { provide: AdminStepUpService, useValue: { issue: vi.fn(), expiresAt: vi.fn() } },
        { provide: TenantLifecycleService, useValue: {
          createDeletion, list: vi.fn(), detail: vi.fn(), createExport: vi.fn(), cancel: vi.fn(), retry: vi.fn(),
        } },
        { provide: SessionService, useValue: { resolve } },
        { provide: CsrfService, useValue: csrf },
        { provide: AUTH_HTTP_CONFIG, useValue: { cookieName: 'session', production: false } },
        { provide: AuthGuard, useFactory: () => new AuthGuard(
          new Reflector(), { resolve } as never, { cookieName: 'session', production: false }, csrf,
        ) },
        { provide: APP_GUARD, useExisting: AuthGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => app.close());

  it('enforces authentication, platform role, CSRF and deletion step-up', async () => {
    const path = `/api/admin/tenants/${tenantId}/lifecycle-deletions`;
    const body = { reasonCode: 'ADMINISTRATIVE_TEST' };
    await request(app.getHttpServer()).post(path).set('idempotency-key', idempotencyKey).send(body).expect(401);
    await request(app.getHttpServer()).post(path)
      .set('Cookie', 'session=user').set('x-csrf-token', csrf.issue(regularUser.sessionId))
      .set('idempotency-key', idempotencyKey).send(body).expect(403);
    await request(app.getHttpServer()).post(path)
      .set('Cookie', 'session=admin').set('idempotency-key', idempotencyKey).send(body).expect(403);
    await request(app.getHttpServer()).post(path)
      .set('Cookie', 'session=admin').set('x-csrf-token', csrf.issue(principal.sessionId))
      .set('idempotency-key', idempotencyKey).send(body).expect(401);
    await request(app.getHttpServer()).post(path)
      .set('Cookie', 'session=admin').set('x-csrf-token', csrf.issue(principal.sessionId))
      .set('x-admin-step-up', 'valid-step-up').set('idempotency-key', idempotencyKey).send(body).expect(201);
    expect(createDeletion).toHaveBeenCalledTimes(2);
  });
});
