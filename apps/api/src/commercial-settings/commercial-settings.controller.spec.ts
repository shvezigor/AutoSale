import { type INestApplication } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthGuard } from '../auth/auth.guard.js';
import { CommercialSettingsController } from './commercial-settings.controller.js';
import { CommercialSettingsService } from './commercial-settings.service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const entityId = '22222222-2222-4222-8222-222222222222';
const entity = { id: entityId, displayName: 'Main', legalName: 'Fictional Main LLC', type: 'COMPANY', registrationId: null, active: true, isDefault: true };

describe('CommercialSettingsController', () => {
  let app: INestApplication;
  const list = vi.fn();
  const createLegalEntity = vi.fn();

  beforeEach(async () => {
    list.mockReset().mockResolvedValue({ legalEntities: [entity], bankAccounts: [] });
    createLegalEntity.mockReset().mockResolvedValue(entity);
    const sessions = { resolve: vi.fn(async (token: string) => token === 'owner'
      ? { userId: 'owner', email: 'owner@example.test', platformRole: 'USER', tenantId, membershipRole: 'OWNER', sessionId: 'owner-session' }
      : token === 'manager'
        ? { userId: 'manager', email: 'manager@example.test', platformRole: 'USER', tenantId, membershipRole: 'MANAGER', sessionId: 'manager-session' }
        : null) };
    const moduleRef = await Test.createTestingModule({
      controllers: [CommercialSettingsController],
      providers: [
        { provide: CommercialSettingsService, useValue: { list, createLegalEntity, updateLegalEntity: vi.fn(), accountDetail: vi.fn(), createBankAccount: vi.fn(), updateBankAccount: vi.fn() } },
        { provide: APP_GUARD, useFactory: () => new AuthGuard(new Reflector(), sessions as never, { cookieName: 'session', production: false }, { verify: () => true } as never) },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => app?.close());

  it('allows a manager to read tenant legal entities', async () => {
    await request(app.getHttpServer()).get('/api/settings/legal-entities').set('Cookie', 'session=manager').expect(200, [entity]);
    expect(list).toHaveBeenCalledWith(tenantId);
  });

  it('allows only an owner to create a legal entity', async () => {
    const body = { displayName: 'Main', legalName: 'Fictional Main LLC', type: 'COMPANY', registrationId: null, active: true, isDefault: true };
    await request(app.getHttpServer()).post('/api/settings/legal-entities').set('Cookie', 'session=owner').set('x-csrf-token', 'csrf').send(body).expect(201, entity);
    expect(createLegalEntity).toHaveBeenCalledWith(tenantId, body);
    await request(app.getHttpServer()).post('/api/settings/legal-entities').set('Cookie', 'session=manager').set('x-csrf-token', 'csrf').send(body).expect(403);
  });

  it('rejects invalid account input before calling the service', async () => {
    await request(app.getHttpServer()).post('/api/settings/bank-accounts').set('Cookie', 'session=owner').set('x-csrf-token', 'csrf')
      .send({ legalEntityId: entityId, label: 'Bad', iban: 'bad', currency: 'UAH', active: true, isDefault: true }).expect(400);
  });
});
