import { type INestApplication } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { AUTH_HTTP_CONFIG } from '../auth/auth.controller.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { CsrfService } from '../auth/csrf.service.js';
import { SessionService } from '../auth/session.service.js';
import { AdminDemoLeadsController } from './admin-demo-leads.controller.js';
import { AdminDemoLeadsService } from './admin-demo-leads.service.js';

const principal = { userId: '11111111-1111-4111-8111-111111111111' };
const leadId = '22222222-2222-4222-8222-222222222222';

describe('AdminDemoLeadsController', () => {
  it('parses and bounds list input before fetching masked summaries', async () => {
    const list = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
    const controller = new AdminDemoLeadsController({ list } as never);
    await expect(controller.list({ status: 'NEW', limit: '1000' })).resolves.toEqual({ items: [], nextCursor: null });
    expect(list).toHaveBeenCalledWith({ status: 'NEW', limit: 1000 });
    expect(() => controller.list({ status: 'INVALID' })).toThrow();
  });

  it('returns detail only after the service audits access and maps missing rows to 404', async () => {
    const detail = vi.fn().mockResolvedValueOnce({ id: leadId }).mockResolvedValueOnce(null);
    const controller = new AdminDemoLeadsController({ detail } as never);
    await expect(controller.detail(principal as never, leadId)).resolves.toEqual({ id: leadId });
    expect(detail).toHaveBeenCalledWith(leadId, principal.userId);
    await expect(controller.detail(principal as never, leadId)).rejects.toMatchObject({ status: 404 });
  });

  it('rejects malformed status payload before changing a lead', async () => {
    const changeStatus = vi.fn();
    const controller = new AdminDemoLeadsController({ changeStatus } as never);
    expect(() => controller.changeStatus(principal as never, leadId, { status: 'QUALIFIED', expectedVersion: -1 })).toThrow();
    expect(changeStatus).not.toHaveBeenCalled();
    await controller.changeStatus(principal as never, leadId, { status: 'CONTACTED', expectedVersion: 0 });
    expect(changeStatus).toHaveBeenCalledWith(leadId, 'CONTACTED', 0, principal.userId);
  });
});

describe('AdminDemoLeadsController HTTP authorization', () => {
  it('blocks tenants, keeps responses uncached and requires CSRF for status changes', async () => {
    const admin = {
      ...principal, email: 'admin@example.test', name: 'Fictional Admin', platformRole: 'PLATFORM_ADMIN' as const,
      tenantId: null, membershipRole: null, locale: 'uk', avatarUrl: null,
      sessionId: '33333333-3333-4333-8333-333333333333',
    };
    const tenant = { ...admin, userId: '44444444-4444-4444-8444-444444444444', platformRole: 'USER' as const };
    const csrf = new CsrfService('p'.repeat(32));
    const resolve = vi.fn(async (token: string) => token === 'admin' ? admin : token === 'tenant' ? tenant : null);
    const list = vi.fn().mockResolvedValue({ items: [{ id: leadId, company: 'Fictional Shop', maskedContact: 'o***@***', status: 'NEW', notificationStatus: 'PENDING', createdAt: '2026-10-20T10:00:00.000Z', version: 0 }], nextCursor: null });
    const changeStatus = vi.fn().mockResolvedValue({ id: leadId, status: 'CONTACTED', version: 1 });
    const exportOne = vi.fn().mockResolvedValue({ id: leadId, company: 'Fictional Shop', email: 'olena@example.test' });
    const exportCsv = vi.fn().mockResolvedValue('id,company\r\n"' + leadId + '","Fictional Shop"\r\n');
    const deleteOne = vi.fn().mockResolvedValue({ deleted: true });
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminDemoLeadsController],
      providers: [
        { provide: AdminDemoLeadsService, useValue: { list, detail: vi.fn(), changeStatus, exportOne, exportCsv, deleteOne } },
        { provide: SessionService, useValue: { resolve } },
        { provide: CsrfService, useValue: csrf },
        { provide: AUTH_HTTP_CONFIG, useValue: { cookieName: 'session', production: false } },
        { provide: AuthGuard, useFactory: () => new AuthGuard(new Reflector(), { resolve } as never, { cookieName: 'session', production: false }, csrf) },
        { provide: APP_GUARD, useExisting: AuthGuard },
      ],
    }).compile();
    const app: INestApplication = moduleRef.createNestApplication();
    await app.init();
    try {
      await request(app.getHttpServer()).get('/api/admin/demo-leads').expect(401);
      await request(app.getHttpServer()).get('/api/admin/demo-leads').set('Cookie', 'session=tenant').expect(403);
      const listed = await request(app.getHttpServer()).get('/api/admin/demo-leads').set('Cookie', 'session=admin').expect(200);
      expect(listed.headers['cache-control']).toBe('no-store');
      expect(JSON.stringify(listed.body)).not.toContain('olena@example.test');
      await request(app.getHttpServer()).patch(`/api/admin/demo-leads/${leadId}/status`)
        .set('Cookie', 'session=admin').send({ status: 'CONTACTED', expectedVersion: 0 }).expect(403);
      await request(app.getHttpServer()).patch(`/api/admin/demo-leads/${leadId}/status`)
        .set('Cookie', 'session=admin').set('x-csrf-token', csrf.issue(admin.sessionId))
        .send({ status: 'CONTACTED', expectedVersion: 0 }).expect(200);
      expect(changeStatus).toHaveBeenCalledWith(leadId, 'CONTACTED', 0, admin.userId);
      await request(app.getHttpServer()).get(`/api/admin/demo-leads/${leadId}/export`)
        .set('Cookie', 'session=tenant').set('x-admin-step-up', 'fictional-token').expect(403);
      const exported = await request(app.getHttpServer()).get(`/api/admin/demo-leads/${leadId}/export`)
        .set('Cookie', 'session=admin').set('x-admin-step-up', 'fictional-token').expect(200);
      expect(exported.headers['cache-control']).toBe('no-store');
      expect(exported.headers['content-disposition']).toContain('attachment');
      expect(exported.headers['content-type']).toContain('application/json');
      expect(exportOne).toHaveBeenCalledWith(leadId, admin.userId, admin.sessionId, 'fictional-token');
      const csv = await request(app.getHttpServer()).get('/api/admin/demo-leads/export.csv?from=2026-10-01&to=2026-10-20')
        .set('Cookie', 'session=admin').set('x-admin-step-up', 'fictional-token').expect(200);
      expect(csv.headers['content-disposition']).toContain('.csv');
      await request(app.getHttpServer()).post(`/api/admin/demo-leads/${leadId}/delete`)
        .set('Cookie', 'session=admin').set('x-admin-step-up', 'fictional-token').send({ confirmId: leadId }).expect(403);
      await request(app.getHttpServer()).post(`/api/admin/demo-leads/${leadId}/delete`)
        .set('Cookie', 'session=admin').set('x-csrf-token', csrf.issue(admin.sessionId))
        .set('x-admin-step-up', 'fictional-token').send({ confirmId: leadId }).expect(201);
      expect(deleteOne).toHaveBeenCalledWith(leadId, leadId, admin.userId, admin.sessionId, 'fictional-token');
    } finally { await app.close(); }
  });
});
