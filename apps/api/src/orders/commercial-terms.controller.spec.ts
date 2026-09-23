import { type INestApplication } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthGuard } from '../auth/auth.guard.js';
import { CommercialTermsController } from './commercial-terms.controller.js';
import { CommercialTermsService } from './commercial-terms.service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const orderId = '22222222-2222-4222-8222-222222222222';
const summary = { pricingStatus: 'READY', issueCodes: [], currency: 'UAH', itemsSubtotal: '10.00', discountAmount: '0.00', deliveryAmount: '0.00', totalAmount: '10.00', legalEntity: null, bankAccount: null, eligibleAccounts: [], version: 1, legacy: false };

describe('CommercialTermsController', () => {
  let app: INestApplication;
  const preview = vi.fn();
  const update = vi.fn();

  beforeEach(async () => {
    preview.mockReset().mockResolvedValue({ ...summary, legacy: true, version: 0 });
    update.mockReset().mockResolvedValue(summary);
    const sessions = { resolve: vi.fn(async () => ({ userId: 'manager-id', email: 'manager@example.test', platformRole: 'USER', tenantId, membershipRole: 'MANAGER', sessionId: 'session' })) };
    const moduleRef = await Test.createTestingModule({
      controllers: [CommercialTermsController],
      providers: [
        { provide: CommercialTermsService, useValue: { preview, update } },
        { provide: APP_GUARD, useFactory: () => new AuthGuard(new Reflector(), sessions as never, { cookieName: 'session', production: false }, { verify: () => true } as never) },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => app?.close());

  it('previews without accepting client totals', async () => {
    await request(app.getHttpServer()).post(`/api/orders/${orderId}/commercial-terms/preview`).set('Cookie', 'session=manager').set('x-csrf-token', 'csrf').expect(201);
    expect(preview).toHaveBeenCalledWith(tenantId, orderId);
  });

  it('accepts versioned selection and rejects submitted totals', async () => {
    const selection = { version: 1, legalEntityId: null, bankAccountId: null };
    await request(app.getHttpServer()).put(`/api/orders/${orderId}/commercial-terms`).set('Cookie', 'session=manager').set('x-csrf-token', 'csrf').send(selection).expect(200, summary);
    expect(update).toHaveBeenCalledWith(tenantId, orderId, 'manager-id', { ...selection, initializeLegacy: false });
    await request(app.getHttpServer()).put(`/api/orders/${orderId}/commercial-terms`).set('Cookie', 'session=manager').set('x-csrf-token', 'csrf').send({ ...selection, totalAmount: '1.00' }).expect(400);
  });

  it('returns a safe account field issue for malformed selection', async () => {
    const result = await request(app.getHttpServer()).put(`/api/orders/${orderId}/commercial-terms`).set('Cookie', 'session=manager').set('x-csrf-token', 'csrf').send({ version: 1, legalEntityId: null, bankAccountId: 'private-account' }).expect(400);
    expect(result.body).toMatchObject({ code: 'VALIDATION_FAILED', issues: [{ field: 'bankAccountId', code: 'INVALID_BANK_ACCOUNT' }] });
    expect(JSON.stringify(result.body)).not.toContain('private-account');
  });
});
