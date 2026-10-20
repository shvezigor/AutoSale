import { type INestApplication } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { AUTH_HTTP_CONFIG } from '../auth/auth.controller.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { CsrfService } from '../auth/csrf.service.js';
import { AdminConversionService } from './admin-conversion.service.js';
import { AdminConversionController } from './admin-conversion.controller.js';

describe('AdminConversionController', () => {
  it('accepts only a bounded fixed date range', async () => {
    const report = vi.fn().mockResolvedValue({ metrics: [] });
    const controller = new AdminConversionController({ report } as never);
    await expect(controller.report({ from: '2026-10-01', to: '2026-10-20' })).resolves.toEqual({ metrics: [] });
    expect(() => controller.report({ from: '2026-10-01', to: '2026-10-20', tenantId: 'anything' })).toThrow();
    expect(() => controller.report({ from: '2026-10-20', to: '2026-10-01' })).toThrow();
  });

  it('denies public and tenant access while keeping platform-admin aggregates uncached', async () => {
    const base = { userId: '11111111-1111-4111-8111-111111111111', sessionId: '22222222-2222-4222-8222-222222222222',
      email: 'admin@example.test', name: 'Fictional Admin', tenantId: null, membershipRole: null, locale: 'uk', avatarUrl: null };
    const admin = { ...base, platformRole: 'PLATFORM_ADMIN' as const };
    const tenant = { ...base, platformRole: 'USER' as const, tenantId: '33333333-3333-4333-8333-333333333333', membershipRole: 'OWNER' as const };
    const resolve = vi.fn(async (token: string) => token === 'admin' ? admin : token === 'tenant' ? tenant : null);
    const report = vi.fn().mockResolvedValue({ from: '2026-10-01', to: '2026-10-20', metrics: [], rates: {}, note: 'counts_not_unique_visitors' });
    const csrf = new CsrfService('p'.repeat(32));
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminConversionController],
      providers: [
        { provide: AdminConversionService, useValue: { report } },
        { provide: AUTH_HTTP_CONFIG, useValue: { cookieName: 'session', production: false } },
        { provide: AuthGuard, useFactory: () => new AuthGuard(new Reflector(), { resolve } as never, { cookieName: 'session', production: false }, csrf) },
        { provide: APP_GUARD, useExisting: AuthGuard },
      ],
    }).compile();
    const app: INestApplication = moduleRef.createNestApplication();
    await app.init();
    try {
      const path = '/api/admin/conversions?from=2026-10-01&to=2026-10-20';
      await request(app.getHttpServer()).get(path).expect(401);
      await request(app.getHttpServer()).get(path).set('Cookie', 'session=tenant').expect(403);
      const response = await request(app.getHttpServer()).get(path).set('Cookie', 'session=admin').expect(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(report).toHaveBeenCalledWith('2026-10-01', '2026-10-20');
    } finally { await app.close(); }
  });
});
