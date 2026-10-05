import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTH_ACCESS_KEY } from '../auth/auth.decorators.js';
import { ReplyStyleController } from './reply-style.controller.js';
import { ReplyStyleService } from './reply-style.service.js';

describe('ReplyStyleController', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  let app: INestApplication | undefined;
  const get = vi.fn();
  const update = vi.fn();

  beforeEach(async () => {
    get.mockResolvedValue({ tenantId, enabled: false, companyName: '', tone: 'NEUTRAL', addressForm: 'FORMAL_YOU', guidance: '' });
    update.mockImplementation(async (_tenantId, input) => ({ tenantId, ...input }));
    const moduleRef = await Test.createTestingModule({
      controllers: [ReplyStyleController],
      providers: [{ provide: ReplyStyleService, useValue: { get, update } }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use((req: { principal?: unknown }, _res: unknown, next: () => void) => {
      req.principal = { userId: 'owner', tenantId, membershipRole: 'OWNER', sessionId: 'fictional-session' };
      next();
    });
    await app.init();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app?.close();
  });

  it('exposes manager read and owner write access metadata', () => {
    expect(Reflect.getMetadata(AUTH_ACCESS_KEY, ReplyStyleController)).toBe('TENANT_MANAGER');
    expect(Reflect.getMetadata(AUTH_ACCESS_KEY, ReplyStyleController.prototype.update)).toBe('TENANT_OWNER');
  });

  it('reads defaults and sends a valid owner patch', async () => {
    await request(app!.getHttpServer()).get('/api/settings/reply-style').expect(200);
    expect(get).toHaveBeenCalledWith(tenantId);
    await request(app!.getHttpServer()).patch('/api/settings/reply-style')
      .send({ enabled: true, companyName: 'Fictional Shop' }).expect(200);
    expect(update).toHaveBeenCalledWith(tenantId, { enabled: true, companyName: 'Fictional Shop' });
  });

  it('returns safe field issues for invalid guidance', async () => {
    const response = await request(app!.getHttpServer()).patch('/api/settings/reply-style')
      .send({ guidance: 'x'.repeat(501) }).expect(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED', issues: [{ field: 'guidance', code: 'INVALID_GUIDANCE' }] });
    expect(update).not.toHaveBeenCalled();
  });
});
