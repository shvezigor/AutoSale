import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

describe('DashboardController', () => {
  let app: INestApplication;
  const summary = vi.fn();

  beforeEach(async () => {
    summary.mockReset().mockResolvedValue({ generatedAt: '2026-09-17T07:00:00.000Z' });
    const moduleRef = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [{ provide: DashboardService, useValue: { summary } }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use((incoming: { principal?: unknown }, _response: unknown, next: () => void) => {
      incoming.principal = {
        userId: 'user-a', email: 'manager@example.com', platformRole: 'USER', tenantId: 'tenant-a',
        membershipRole: 'MANAGER', locale: 'uk', avatarUrl: null, sessionId: 'session-a',
      };
      next();
    });
    await app.init();
  });

  afterEach(async () => app.close());

  it('exports the dashboard HTTP controller', async () => {
    const module = await import('./dashboard.controller.js').catch(() => ({}));
    expect(module).toHaveProperty('DashboardController');
  });

  it('defaults to 30 days and supplies the authenticated tenant', async () => {
    await request(app.getHttpServer()).get('/api/dashboard').expect(200, { generatedAt: '2026-09-17T07:00:00.000Z' });
    expect(summary).toHaveBeenCalledWith('tenant-a', '30d');
  });

  it('accepts allowlisted periods and rejects unknown or extra query fields', async () => {
    await request(app.getHttpServer()).get('/api/dashboard?period=7d').expect(200);
    expect(summary).toHaveBeenLastCalledWith('tenant-a', '7d');

    await request(app.getHttpServer()).get('/api/dashboard?period=365d').expect(400);
    await request(app.getHttpServer()).get('/api/dashboard?period=30d&tenantId=other').expect(400);
  });
});
