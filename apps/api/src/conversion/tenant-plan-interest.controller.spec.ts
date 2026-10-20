import { type INestApplication } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { AUTH_HTTP_CONFIG } from '../auth/auth.controller.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { CsrfService } from '../auth/csrf.service.js';
import { ConversionService } from './conversion.service.js';
import { TenantPlanInterestController } from './tenant-plan-interest.controller.js';

describe('TenantPlanInterestController', () => {
  const principal = { tenantId: '11111111-1111-4111-8111-111111111111' };
  it('accepts only an approved plan and passes current tenant identity', async () => {
    const recordPlanInterest = vi.fn().mockResolvedValue({ recorded: true });
    const controller = new TenantPlanInterestController({ recordPlanInterest } as never);
    await expect(controller.record(principal as never, { planId: 'growth' })).resolves.toEqual({ recorded: true });
    expect(recordPlanInterest).toHaveBeenCalledWith(principal.tenantId, 'growth');
    expect(() => controller.record(principal as never, { planId: 'unknown' })).toThrow();
    expect(() => controller.record(principal as never, { planId: 'growth', tenantId: 'other' })).toThrow();
  });

  it('requires a manager session and CSRF; never accepts a supplied tenant identifier', async () => {
    const manager = { userId: '11111111-1111-4111-8111-111111111111', sessionId: '22222222-2222-4222-8222-222222222222',
      email: 'manager@example.test', name: 'Fictional Manager', tenantId: principal.tenantId,
      membershipRole: 'MANAGER' as const, platformRole: 'USER' as const, locale: 'uk', avatarUrl: null };
    const resolve = vi.fn(async (token: string) => token === 'manager' ? manager : null);
    const csrf = new CsrfService('p'.repeat(32));
    const recordPlanInterest = vi.fn().mockResolvedValue({ recorded: true });
    const moduleRef = await Test.createTestingModule({
      controllers: [TenantPlanInterestController],
      providers: [
        { provide: ConversionService, useValue: { recordPlanInterest } },
        { provide: AUTH_HTTP_CONFIG, useValue: { cookieName: 'session', production: false } },
        { provide: AuthGuard, useFactory: () => new AuthGuard(new Reflector(), { resolve } as never, { cookieName: 'session', production: false }, csrf) },
        { provide: APP_GUARD, useExisting: AuthGuard },
      ],
    }).compile();
    const app: INestApplication = moduleRef.createNestApplication();
    await app.init();
    try {
      await request(app.getHttpServer()).post('/api/conversion/plan-interest').send({ planId: 'growth' }).expect(401);
      await request(app.getHttpServer()).post('/api/conversion/plan-interest').set('Cookie', 'session=manager').send({ planId: 'growth' }).expect(403);
      const response = await request(app.getHttpServer()).post('/api/conversion/plan-interest')
        .set('Cookie', 'session=manager').set('x-csrf-token', csrf.issue(manager.sessionId)).send({ planId: 'growth' }).expect(201);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(recordPlanInterest).toHaveBeenCalledWith(manager.tenantId, 'growth');
      await request(app.getHttpServer()).post('/api/conversion/plan-interest')
        .set('Cookie', 'session=manager').set('x-csrf-token', csrf.issue(manager.sessionId))
        .send({ planId: 'growth', tenantId: 'fictional-other' }).expect(400);
    } finally { await app.close(); }
  });
});
