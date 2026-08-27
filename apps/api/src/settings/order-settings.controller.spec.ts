import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OrderSettingsController } from './order-settings.controller.js';
import { OrderSettingsService } from './order-settings.service.js';

describe('OrderSettingsController', () => {
  let app: INestApplication | undefined;
  const get = vi.fn();
  const update = vi.fn();

  beforeEach(async () => {
    get.mockResolvedValue({
      approvalMode: 'ALWAYS',
      autoApprovalThreshold: 0.9,
      promptVersion: 'instagram-order-v1',
      triggerPhrases: ['беремо замовлення в роботу'],
    });
    update.mockImplementation(async (input) => ({
      approvalMode: input.approvalMode,
      autoApprovalThreshold: input.autoApprovalThreshold ?? 0.9,
      promptVersion: 'instagram-order-v1',
      triggerPhrases: input.triggerPhrases ?? ['беремо замовлення в роботу'],
    }));
    const moduleRef = await Test.createTestingModule({
      controllers: [OrderSettingsController],
      providers: [{ provide: OrderSettingsService, useValue: { get, update } }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => app?.close());

  it('returns the current approval policy', async () => {
    const response = await request(app!.getHttpServer()).get('/api/settings/orders').expect(200);

    expect(response.body.approvalMode).toBe('ALWAYS');
  });

  it('updates the approval policy', async () => {
    const response = await request(app!.getHttpServer())
      .patch('/api/settings/orders')
      .send({ approvalMode: 'NEVER' })
      .expect(200);

    expect(response.body.approvalMode).toBe('NEVER');
    expect(update).toHaveBeenCalledWith({ approvalMode: 'NEVER' });
  });

  it('rejects an unsupported approval mode', async () => {
    await request(app!.getHttpServer())
      .patch('/api/settings/orders')
      .send({ approvalMode: 'SOMETIMES' })
      .expect(400);
  });
});
