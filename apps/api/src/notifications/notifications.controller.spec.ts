import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationsController } from './notifications.controller.js';
import { NotificationService } from './notifications.service.js';

describe('NotificationsController', () => {
  let app: INestApplication;
  const list = vi.fn();
  const markRead = vi.fn();
  const markAllRead = vi.fn();

  beforeEach(async () => {
    list.mockReset().mockResolvedValue({ items: [], unreadCount: 0 });
    markRead.mockReset().mockResolvedValue({ updated: true });
    markAllRead.mockReset().mockResolvedValue({ updatedCount: 2 });
    const moduleRef = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [{ provide: NotificationService, useValue: { list, markRead, markAllRead } }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use((req: { principal?: unknown }, _res: unknown, next: () => void) => {
      req.principal = { tenantId: 'tenant-a', userId: 'user-a', membershipRole: 'MANAGER' };
      next();
    });
    await app.init();
  });

  afterEach(async () => app.close());

  it('lists notifications in the current principal scope', async () => {
    await request(app.getHttpServer()).get('/api/notifications?limit=12').expect(200, { items: [], unreadCount: 0 });
    expect(list).toHaveBeenCalledWith('tenant-a', 'user-a', 12);
  });

  it('marks one scoped notification read', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    await request(app.getHttpServer()).post(`/api/notifications/${id}/read`).expect(201, { updated: true });
    expect(markRead).toHaveBeenCalledWith('tenant-a', 'user-a', id);
  });

  it('marks all scoped notifications read', async () => {
    await request(app.getHttpServer()).post('/api/notifications/read-all').expect(201, { updatedCount: 2 });
    expect(markAllRead).toHaveBeenCalledWith('tenant-a', 'user-a');
  });

  it('rejects an invalid notification id', async () => {
    await request(app.getHttpServer()).post('/api/notifications/not-a-uuid/read').expect(400);
    expect(markRead).not.toHaveBeenCalled();
  });
});
