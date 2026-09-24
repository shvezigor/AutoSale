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
  const createBankAccount = vi.fn();
  const deleteLegalEntity = vi.fn();
  const deleteBankAccount = vi.fn();

  beforeEach(async () => {
    list.mockReset().mockResolvedValue({ legalEntities: [entity], bankAccounts: [] });
    createLegalEntity.mockReset().mockResolvedValue(entity);
    createBankAccount.mockReset();
    deleteLegalEntity.mockReset().mockResolvedValue(undefined);
    deleteBankAccount.mockReset().mockResolvedValue(undefined);
    const sessions = { resolve: vi.fn(async (token: string) => token === 'owner'
      ? { userId: 'owner', email: 'owner@example.test', platformRole: 'USER', tenantId, membershipRole: 'OWNER', sessionId: 'owner-session' }
      : token === 'manager'
        ? { userId: 'manager', email: 'manager@example.test', platformRole: 'USER', tenantId, membershipRole: 'MANAGER', sessionId: 'manager-session' }
        : null) };
    const moduleRef = await Test.createTestingModule({
      controllers: [CommercialSettingsController],
      providers: [
        { provide: CommercialSettingsService, useValue: { list, createLegalEntity, updateLegalEntity: vi.fn(), deleteLegalEntity, accountDetail: vi.fn(), createBankAccount, updateBankAccount: vi.fn(), deleteBankAccount } },
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

  it('returns safe field issues for invalid account input before calling the service', async () => {
    const response = await request(app.getHttpServer()).post('/api/settings/bank-accounts').set('Cookie', 'session=owner').set('x-csrf-token', 'csrf')
      .send({ legalEntityId: entityId, label: 'Bad', iban: 'private-invalid-iban', currency: 'X', active: true, isDefault: true }).expect(400);

    expect(response.body).toEqual({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      issues: [
        { field: 'iban', code: 'INVALID_IBAN' },
        { field: 'currency', code: 'INVALID_CURRENCY' },
      ],
    });
    expect(JSON.stringify(response.body)).not.toContain('private-invalid-iban');
    expect(createBankAccount).not.toHaveBeenCalled();
  });

  it('allows only an owner to delete a legal entity', async () => {
    await request(app.getHttpServer()).delete(`/api/settings/legal-entities/${entityId}`).set('Cookie', 'session=owner').set('x-csrf-token', 'csrf').expect(204);
    expect(deleteLegalEntity).toHaveBeenCalledWith(tenantId, entityId);
    await request(app.getHttpServer()).delete(`/api/settings/legal-entities/${entityId}`).set('Cookie', 'session=manager').set('x-csrf-token', 'csrf').expect(403);
  });

  it('allows only an owner to delete a bank account', async () => {
    const accountId = '33333333-3333-4333-8333-333333333333';
    await request(app.getHttpServer()).delete(`/api/settings/bank-accounts/${accountId}`).set('Cookie', 'session=owner').set('x-csrf-token', 'csrf').expect(204);
    expect(deleteBankAccount).toHaveBeenCalledWith(tenantId, accountId);
    await request(app.getHttpServer()).delete(`/api/settings/bank-accounts/${accountId}`).set('Cookie', 'session=manager').set('x-csrf-token', 'csrf').expect(403);
  });
});
