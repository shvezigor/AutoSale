import { type INestApplication } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthGuard } from '../auth/auth.guard.js';
import { CatalogueController } from './catalogue.controller.js';
import { CatalogueService } from './catalogue.service.js';

const productId = '11111111-1111-4111-8111-111111111111';
const tenantId = '22222222-2222-4222-8222-222222222222';
const product = {
  id: productId, sku: 'LUNA-01', name: 'Luna', description: null, price: null, currency: null,
  stockQuantity: null, category: null, brand: null, aliases: [], color: null, size: null,
  imageUrls: [], attributes: {}, active: true, sourceId: null, sourceRowKey: null, sourceUpdatedAt: null,
  createdAt: '2026-08-31T10:00:00.000Z', updatedAt: '2026-08-31T10:00:00.000Z',
};

describe('CatalogueController', () => {
  let app: INestApplication;
  const list = vi.fn();
  const create = vi.fn();
  const update = vi.fn();
  const clear = vi.fn();

  beforeEach(async () => {
    list.mockReset().mockResolvedValue({ items: [product], page: 1, pageSize: 25, total: 1 });
    create.mockReset().mockResolvedValue(product);
    update.mockReset().mockResolvedValue(product);
    clear.mockReset().mockResolvedValue({ deleted: 14 });
    const sessions = {
      resolve: vi.fn(async (token: string) => token === 'owner'
        ? { userId: 'owner', email: 'owner@example.com', platformRole: 'USER', tenantId, membershipRole: 'OWNER', sessionId: 'owner-session' }
        : token === 'manager'
          ? { userId: 'manager', email: 'manager@example.com', platformRole: 'USER', tenantId, membershipRole: 'MANAGER', sessionId: 'manager-session' }
          : null),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [CatalogueController],
      providers: [
        { provide: CatalogueService, useValue: { list, create, update, clear } },
        {
          provide: APP_GUARD,
          useFactory: () => new AuthGuard(
            new Reflector(),
            sessions as never,
            { cookieName: 'session', production: false },
            { verify: () => true } as never,
          ),
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => app?.close());

  it('allows a manager to list tenant catalogue products', async () => {
    await request(app.getHttpServer()).get('/api/catalogue?search=Luna&page=1&pageSize=25').set('Cookie', 'session=manager').expect(200, { items: [product], page: 1, pageSize: 25, total: 1 });

    expect(list).toHaveBeenCalledWith(tenantId, { search: 'Luna', page: 1, pageSize: 25 });
  });

  it('allows an owner to create a product', async () => {
    await request(app.getHttpServer()).post('/api/catalogue').set('Cookie', 'session=owner').set('x-csrf-token', 'csrf').send({ sku: 'LUNA-01', name: 'Luna', aliases: [] }).expect(201, product);

    expect(create).toHaveBeenCalledWith(tenantId, { sku: 'LUNA-01', name: 'Luna', aliases: [] });
  });

  it('allows an owner to patch a product', async () => {
    await request(app.getHttpServer()).patch(`/api/catalogue/${productId}`).set('Cookie', 'session=owner').set('x-csrf-token', 'csrf').send({ name: 'Luna Pro' }).expect(200, product);

    expect(update).toHaveBeenCalledWith(tenantId, productId, { name: 'Luna Pro' });
  });

  it('returns 401 without an authenticated session', async () => {
    await request(app.getHttpServer()).get('/api/catalogue').expect(401);
  });

  it('returns 403 when a manager attempts a mutation', async () => {
    await request(app.getHttpServer()).post('/api/catalogue').set('Cookie', 'session=manager').send({ sku: 'LUNA-01', name: 'Luna', aliases: [] }).expect(403);

    expect(create).not.toHaveBeenCalled();
  });

  it('allows only an owner to clear the tenant catalogue', async () => {
    await request(app.getHttpServer()).delete('/api/catalogue').set('Cookie', 'session=owner').set('x-csrf-token', 'csrf').expect(200, { deleted: 14 });
    expect(clear).toHaveBeenCalledWith(tenantId, 'owner');

    await request(app.getHttpServer()).delete('/api/catalogue').set('Cookie', 'session=manager').set('x-csrf-token', 'csrf').expect(403);
  });
});
