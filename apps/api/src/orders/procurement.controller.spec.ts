import type { AuthPrincipal } from '@autosale/contracts/auth';
import { NotFoundException, type INestApplication } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthGuard } from '../auth/auth.guard.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const orderId = '22222222-2222-4222-8222-222222222222';
const itemId = '33333333-3333-4333-8333-333333333333';
const manager: AuthPrincipal = {
  userId: '44444444-4444-4444-8444-444444444444',
  email: 'manager@example.com',
  name: 'Manager',
  platformRole: 'USER',
  tenantId,
  membershipRole: 'MANAGER',
  sessionId: 'manager-session',
};
const outsider: AuthPrincipal = {
  ...manager,
  userId: '55555555-5555-4555-8555-555555555555',
  tenantId: null,
  membershipRole: null,
  sessionId: 'outsider-session',
};

describe('order procurement controller', () => {
  let app: INestApplication;
  const setItemProcurement = vi.fn();
  const handOff = vi.fn();

  beforeEach(async () => {
    setItemProcurement.mockReset().mockResolvedValue({ id: orderId, procurementSummary: 'NEEDS_ORDER' });
    handOff.mockReset().mockResolvedValue({ id: orderId, procurementSummary: 'HANDED_OFF' });
    const sessions = {
      resolve: vi.fn(async (token: string) => token === 'manager' ? manager : token === 'outsider' ? outsider : null),
    };
    const csrf = { verify: vi.fn((_sessionId: string, token: string) => token === 'valid-csrf') };
    const moduleRef = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [
        { provide: OrdersService, useValue: { setItemProcurement, handOff } },
        { provide: AuthGuard, useFactory: () => new AuthGuard(
          new Reflector(), sessions as never, { cookieName: 'session', production: false }, csrf as never,
        ) },
        { provide: APP_GUARD, useExisting: AuthGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => app.close());

  it('uses the authenticated manager as the audit actor', async () => {
    await request(app.getHttpServer())
      .put(`/api/orders/${orderId}/items/${itemId}/procurement`)
      .set('Cookie', 'session=manager')
      .set('x-csrf-token', 'valid-csrf')
      .send({ status: 'TO_ORDER' })
      .expect(200);
    expect(setItemProcurement).toHaveBeenCalledWith(tenantId, orderId, itemId, 'TO_ORDER', manager.userId);

    await request(app.getHttpServer())
      .post(`/api/orders/${orderId}/hand-off`)
      .set('Cookie', 'session=manager')
      .set('x-csrf-token', 'valid-csrf')
      .expect(201);
    expect(handOff).toHaveBeenCalledWith(tenantId, orderId, manager.userId);
  });

  it('rejects internal and malformed manual statuses', async () => {
    for (const status of ['SENDING', 'bad-status']) {
      await request(app.getHttpServer())
        .put(`/api/orders/${orderId}/items/${itemId}/procurement`)
        .set('Cookie', 'session=manager')
        .set('x-csrf-token', 'valid-csrf')
        .send({ status })
        .expect(400);
    }
    expect(setItemProcurement).not.toHaveBeenCalled();
  });

  it('enforces authentication, membership and CSRF', async () => {
    await request(app.getHttpServer())
      .put(`/api/orders/${orderId}/items/${itemId}/procurement`)
      .send({ status: 'TO_ORDER' })
      .expect(401);
    await request(app.getHttpServer())
      .put(`/api/orders/${orderId}/items/${itemId}/procurement`)
      .set('Cookie', 'session=outsider')
      .set('x-csrf-token', 'valid-csrf')
      .send({ status: 'TO_ORDER' })
      .expect(403);
    await request(app.getHttpServer())
      .put(`/api/orders/${orderId}/items/${itemId}/procurement`)
      .set('Cookie', 'session=manager')
      .send({ status: 'TO_ORDER' })
      .expect(403);
    expect(setItemProcurement).not.toHaveBeenCalled();
  });

  it('returns the safe not-found response from tenant-scoped lookup', async () => {
    setItemProcurement.mockRejectedValueOnce(new NotFoundException('Order item not found'));
    await request(app.getHttpServer())
      .put(`/api/orders/${orderId}/items/${itemId}/procurement`)
      .set('Cookie', 'session=manager')
      .set('x-csrf-token', 'valid-csrf')
      .send({ status: 'TO_ORDER' })
      .expect(404, { message: 'Order item not found', error: 'Not Found', statusCode: 404 });
  });
});
