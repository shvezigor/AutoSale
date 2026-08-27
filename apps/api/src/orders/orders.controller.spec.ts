import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';

const orderId = '11111111-1111-4111-8111-111111111111';

const order = {
  id: orderId,
  status: 'NEEDS_REVIEW',
  participantName: 'Олена',
  channel: 'INSTAGRAM',
  overallConfidence: 0.82,
  validationIssues: [],
  customer: { name: 'Олена', phone: '+380671234567', instagramUsername: 'olena' },
  delivery: { city: 'Київ', address: null, novaPoshtaBranch: '24' },
  items: [{ id: 'item-1', catalogId: 'UB-038-BLK', productName: 'Кросівки Urban Black', originalText: 'чорна модель 38', quantity: 1, color: 'Чорний', size: '38', confidence: 0.82 }],
  catalogueCandidates: [{ sku: 'UB-038-BLK', name: 'Кросівки Urban Black' }],
  createdAt: '2026-08-26T12:00:00.000Z',
};

describe('OrdersController', () => {
  let app: INestApplication;
  const list = vi.fn();
  const detail = vi.fn();
  const approve = vi.fn();
  const cancel = vi.fn();
  const update = vi.fn();
  const retrySheetsExport = vi.fn();

  beforeEach(async () => {
    list.mockReset().mockResolvedValue({ items: [order] });
    detail.mockReset().mockResolvedValue(order);
    approve.mockReset().mockResolvedValue({ ...order, status: 'APPROVED' });
    cancel.mockReset().mockResolvedValue({ ...order, status: 'CANCELLED' });
    update.mockReset().mockResolvedValue({ ...order, customer: { ...order.customer, phone: '+380501112233' } });
    retrySheetsExport.mockReset().mockResolvedValue({ status: 'PENDING' });
    const moduleRef = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [{ provide: OrdersService, useValue: { list, detail, approve, cancel, update, retrySheetsExport } }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => app.close());

  it('lists reviewable orders and returns their details', async () => {
    const response = await request(app.getHttpServer()).get('/api/orders').expect(200);
    expect(response.body).toEqual({ items: [order] });
    await request(app.getHttpServer()).get(`/api/orders/${orderId}`).expect(200, order);
  });

  it('approves a valid order with the manager actor', async () => {
    await request(app.getHttpServer())
      .post(`/api/orders/${orderId}/approve`)
      .send({ actor: 'Андрій' })
      .expect(201);
    expect(approve).toHaveBeenCalledWith(orderId, 'Андрій');
  });

  it('cancels an order with the manager actor', async () => {
    await request(app.getHttpServer())
      .post(`/api/orders/${orderId}/cancel`)
      .send({ actor: 'Андрій' })
      .expect(201);
    expect(cancel).toHaveBeenCalledWith(orderId, 'Андрій');
  });

  it('rejects an empty actor', async () => {
    await request(app.getHttpServer()).post(`/api/orders/${orderId}/approve`).send({ actor: '' }).expect(400);
    expect(approve).not.toHaveBeenCalled();
  });

  it('updates corrected fields with the manager actor', async () => {
    await request(app.getHttpServer()).patch(`/api/orders/${orderId}`).send({ actor: 'Андрій', customer: { phone: '+380501112233' } }).expect(200);
    expect(update).toHaveBeenCalledWith(orderId, 'Андрій', { customer: { phone: '+380501112233' } });
  });

  it('requests a safe retry for the order export', async () => {
    await request(app.getHttpServer()).post(`/api/orders/${orderId}/sheets-export/retry`).expect(201, { status: 'PENDING' });
    expect(retrySheetsExport).toHaveBeenCalledWith(orderId);
  });
});
