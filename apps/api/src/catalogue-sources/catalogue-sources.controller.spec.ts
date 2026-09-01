import { type INestApplication } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthGuard } from '../auth/auth.guard.js';
import { CatalogueSourcesController } from './catalogue-sources.controller.js';
import { CatalogueSourcesService } from './catalogue-sources.service.js';

describe('CatalogueSourcesController', () => {
  const tenantId = '22222222-2222-4222-8222-222222222222';
  const sourceId = '44444444-4444-4444-8444-444444444444';
  let app: INestApplication;
  const sources = {
    listHealth: vi.fn(), getConfiguration: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(),
    checkConnectivity: vi.fn(), synchronizeNow: vi.fn(),
  };

  beforeEach(async () => {
    for (const method of Object.values(sources)) method.mockReset();
    sources.listHealth.mockResolvedValue([{ id: sourceId, type: 'GOOGLE_SHEETS', displayName: 'Каталог', status: 'ACTIVE', lastSyncedAt: null, lastErrorSummary: null, updatedAt: '2026-09-01T08:00:00.000Z' }]);
    sources.getConfiguration.mockResolvedValue({ id: sourceId, spreadsheetId: 'private-sheet-id', sheetName: 'Товари', syncSchedule: 'MANUAL' });
    sources.create.mockResolvedValue({ id: sourceId, status: 'PENDING' });
    sources.update.mockResolvedValue({ id: sourceId, status: 'PENDING' });
    sources.remove.mockResolvedValue({ deleted: true });
    sources.checkConnectivity.mockResolvedValue({ connected: true, headers: ['SKU', 'Name'], fingerprint: 'fingerprint' });
    sources.synchronizeNow.mockResolvedValue({ queued: true, sourceId });
    const sessions = { resolve: async (token: string) => token === 'owner'
      ? { userId: 'owner-user', email: 'owner@example.com', platformRole: 'USER', tenantId, membershipRole: 'OWNER', sessionId: 'owner-session' }
      : token === 'manager'
        ? { userId: 'manager-user', email: 'manager@example.com', platformRole: 'USER', tenantId, membershipRole: 'MANAGER', sessionId: 'manager-session' }
        : null };
    const moduleRef = await Test.createTestingModule({
      controllers: [CatalogueSourcesController],
      providers: [
        { provide: CatalogueSourcesService, useValue: sources },
        { provide: APP_GUARD, useFactory: () => new AuthGuard(new Reflector(), sessions as never, { cookieName: 'session', production: false }, { verify: () => true } as never) },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => app?.close());

  it('shows managers only source health while configuration remains owner-only', async () => {
    const health = await request(app.getHttpServer()).get('/api/catalogue/sources').set('Cookie', 'session=manager').expect(200);
    expect(health.body[0]).not.toHaveProperty('spreadsheetId');
    expect(sources.listHealth).toHaveBeenCalledWith(tenantId);
    await request(app.getHttpServer()).get(`/api/catalogue/sources/${sourceId}`).set('Cookie', 'session=manager').expect(403);
    await request(app.getHttpServer()).get(`/api/catalogue/sources/${sourceId}`).set('Cookie', 'session=owner').expect(200);
    expect(sources.getConfiguration).toHaveBeenCalledWith(tenantId, sourceId);
  });

  it('allows only an owner with CSRF to configure, test, sync, and remove a source', async () => {
    const input = { displayName: 'Каталог', spreadsheet: 'sheet-123', sheetName: 'Товари', syncSchedule: 'DAILY' };
    await request(app.getHttpServer()).post('/api/catalogue/sources').set('Cookie', 'session=owner').set('x-csrf-token', 'csrf').send(input).expect(201);
    expect(sources.create).toHaveBeenCalledWith(tenantId, 'owner-user', input);
    await request(app.getHttpServer()).patch(`/api/catalogue/sources/${sourceId}`).set('Cookie', 'session=owner').set('x-csrf-token', 'csrf').send(input).expect(200);
    await request(app.getHttpServer()).post(`/api/catalogue/sources/${sourceId}/check`).set('Cookie', 'session=owner').set('x-csrf-token', 'csrf').expect(201);
    await request(app.getHttpServer()).post(`/api/catalogue/sources/${sourceId}/sync`).set('Cookie', 'session=owner').set('x-csrf-token', 'csrf').expect(201);
    await request(app.getHttpServer()).delete(`/api/catalogue/sources/${sourceId}`).set('Cookie', 'session=owner').set('x-csrf-token', 'csrf').expect(200);
    await request(app.getHttpServer()).post('/api/catalogue/sources').set('Cookie', 'session=manager').set('x-csrf-token', 'csrf').send(input).expect(403);
  });

  it('rejects uploaded credential JSON and mutations without CSRF before service execution', async () => {
    const body = { displayName: 'Каталог', spreadsheet: 'sheet-123', sheetName: 'Товари', syncSchedule: 'MANUAL', credentials: { private_key: 'secret' } };
    await request(app.getHttpServer()).post('/api/catalogue/sources').set('Cookie', 'session=owner').set('x-csrf-token', 'csrf').send(body).expect(400);
    await request(app.getHttpServer()).post('/api/catalogue/sources').set('Cookie', 'session=owner').send({ ...body, credentials: undefined }).expect(403);
    expect(sources.create).not.toHaveBeenCalled();
  });
});
