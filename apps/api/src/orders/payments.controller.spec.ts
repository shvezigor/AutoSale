import type { AuthPrincipal } from '@autosale/contracts/auth';
import { type INestApplication } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthGuard } from '../auth/auth.guard.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const orderId = '22222222-2222-4222-8222-222222222222';
const paymentId = '33333333-3333-4333-8333-333333333333';
const owner: AuthPrincipal = { userId: '44444444-4444-4444-8444-444444444444', email: 'owner@example.invalid', name: 'Owner', platformRole: 'USER', tenantId, membershipRole: 'OWNER', locale: 'uk', avatarUrl: null, sessionId: 'owner-session' };
const manager: AuthPrincipal = { ...owner, userId: '55555555-5555-4555-8555-555555555555', email: 'manager@example.invalid', name: 'Manager', membershipRole: 'MANAGER', sessionId: 'manager-session' };

describe('PaymentsController', () => {
  let app: INestApplication;
  const get = vi.fn();
  const record = vi.fn();
  const cancel = vi.fn();

  beforeEach(async () => {
    get.mockReset().mockResolvedValue({ status: 'UNPAID' });
    record.mockReset().mockResolvedValue({ status: 'PARTIALLY_PAID' });
    cancel.mockReset().mockResolvedValue({ status: 'UNPAID' });
    const sessions = { resolve: vi.fn(async (token: string) => token === 'owner' ? owner : token === 'manager' ? manager : null) };
    const csrf = { verify: vi.fn((_sessionId: string, token: string) => token === 'valid-csrf') };
    const moduleRef = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        { provide: PaymentsService, useValue: { get, record, cancel } },
        { provide: AuthGuard, useFactory: () => new AuthGuard(new Reflector(), sessions as never, { cookieName: 'session', production: false }, csrf as never) },
        { provide: APP_GUARD, useExisting: AuthGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => app.close());

  it('allows a manager to read and record with CSRF', async () => {
    await request(app.getHttpServer()).get(`/api/orders/${orderId}/payments`).set('Cookie', 'session=manager').expect(200);
    await request(app.getHttpServer()).post(`/api/orders/${orderId}/payments`).set('Cookie', 'session=manager').set('x-csrf-token', 'valid-csrf').send({
      amount: '100.00', method: 'CASH', receivedAt: '2026-09-21T10:00:00.000Z', idempotencyKey: '66666666-6666-4666-8666-666666666666',
    }).expect(201);
    expect(record).toHaveBeenCalledWith(tenantId, orderId, manager.userId, expect.objectContaining({ amount: '100.00', method: 'CASH' }));
  });

  it('requires owner role to cancel a payment', async () => {
    const body = { reason: 'Wrong amount', idempotencyKey: '77777777-7777-4777-8777-777777777777' };
    await request(app.getHttpServer()).post(`/api/orders/${orderId}/payments/${paymentId}/cancel`).set('Cookie', 'session=manager').set('x-csrf-token', 'valid-csrf').send(body).expect(403);
    await request(app.getHttpServer()).post(`/api/orders/${orderId}/payments/${paymentId}/cancel`).set('Cookie', 'session=owner').set('x-csrf-token', 'valid-csrf').send(body).expect(201);
    expect(cancel).toHaveBeenCalledWith(tenantId, orderId, paymentId, owner.userId, body);
  });

  it('rejects missing CSRF and malformed commands', async () => {
    await request(app.getHttpServer()).post(`/api/orders/${orderId}/payments`).set('Cookie', 'session=manager').send({}).expect(403);
    await request(app.getHttpServer()).post(`/api/orders/${orderId}/payments`).set('Cookie', 'session=manager').set('x-csrf-token', 'valid-csrf').send({}).expect(400);
    expect(record).not.toHaveBeenCalled();
  });

  it('returns safe field codes without echoing payment values', async () => {
    const result = await request(app.getHttpServer()).post(`/api/orders/${orderId}/payments`).set('Cookie', 'session=manager').set('x-csrf-token', 'valid-csrf').send({
      amount: '0.00', method: 'BANK_TRANSFER', receivedAt: '2026-09-21T10:00:00.000Z', bankAccountId: 'private-account', idempotencyKey: '66666666-6666-4666-8666-666666666666',
    }).expect(400);
    expect(result.body).toMatchObject({ code: 'VALIDATION_FAILED', issues: expect.arrayContaining([{ field: 'amount', code: 'INVALID_AMOUNT' }, { field: 'bankAccountId', code: 'INVALID_BANK_ACCOUNT' }]) });
    expect(JSON.stringify(result.body)).not.toContain('private-account');
  });
});
