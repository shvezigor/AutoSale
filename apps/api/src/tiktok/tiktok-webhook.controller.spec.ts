import { createHmac } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SOCIAL_INBOUND_QUEUE } from '../queue/queue.module.js';
import { TikTokEventService } from './tiktok-event.service.js';
import { TIKTOK_WEBHOOK_CONFIG, TikTokWebhookController } from './tiktok-webhook.controller.js';
import { TikTokSignatureService } from './tiktok-signature.service.js';

const secret = 'fictional-tiktok-secret';
const accountId = 'fictional-business-account';
const payload = {
  client_key: 'fictional-tiktok-client', event: 'im_receive_msg', create_time: 1_780_000_000,
  user_openid: accountId,
  content: JSON.stringify({
    conversation_id: 'conversation-a', message_id: 'message-a', timestamp: 1_780_000_000_000,
    type: 'text', text: { body: 'Fictional order' },
  }),
};

describe('TikTokWebhookController', () => {
  const resolveTenant = vi.fn();
  const register = vi.fn();
  const queue = { add: vi.fn() };
  let app: INestApplication | undefined;

  beforeEach(async () => {
    resolveTenant.mockReset().mockResolvedValue('tenant-a');
    register.mockReset().mockResolvedValue({ eventId: 'event-a', duplicate: false, pending: true });
    queue.add.mockReset().mockResolvedValue(undefined);
    const moduleRef = await Test.createTestingModule({
      controllers: [TikTokWebhookController],
      providers: [
        { provide: TIKTOK_WEBHOOK_CONFIG, useValue: { appId: 'fictional-tiktok-client', enabled: true } },
        { provide: TikTokSignatureService, useValue: new TikTokSignatureService(secret, () => 1_780_000_000, 300) },
        { provide: TikTokEventService, useValue: { resolveTenant, register } },
        { provide: SOCIAL_INBOUND_QUEUE, useValue: queue },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
  });

  afterEach(async () => app?.close());

  function signedBody(body: object) {
    const raw = JSON.stringify(body);
    const signature = createHmac('sha256', secret).update(`1780000000.${raw}`).digest('hex');
    return { raw, header: `t=1780000000,s=${signature}` };
  }

  it('verifies, routes, durably registers, and dispatches one message event', async () => {
    const signed = signedBody(payload);
    await request(app!.getHttpServer()).post('/webhooks/tiktok')
      .set('content-type', 'application/json').set('tiktok-signature', signed.header)
      .send(signed.raw).expect(200, { received: true });
    expect(resolveTenant).toHaveBeenCalledWith(accountId);
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a', externalEventId: 'tiktok:message-a', payload,
    }));
    expect(queue.add).toHaveBeenCalledWith(
      'tiktok.normalize',
      { tenantId: 'tenant-a', eventId: 'event-a', correlationId: 'event-a' },
      { jobId: 'event-a', removeOnFail: true },
    );
  });

  it('rejects an invalid signature before tenant or database access', async () => {
    await request(app!.getHttpServer()).post('/webhooks/tiktok')
      .set('content-type', 'application/json').set('tiktok-signature', 't=1780000000,s=bad')
      .send(JSON.stringify(payload)).expect(401);
    expect(resolveTenant).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it('acknowledges unknown accounts and broker failures without losing the durable record', async () => {
    resolveTenant.mockResolvedValueOnce(null);
    const signed = signedBody(payload);
    await request(app!.getHttpServer()).post('/webhooks/tiktok')
      .set('content-type', 'application/json').set('tiktok-signature', signed.header).send(signed.raw).expect(200);
    expect(register).not.toHaveBeenCalled();

    resolveTenant.mockResolvedValueOnce('tenant-a');
    queue.add.mockRejectedValueOnce(new Error('redis unavailable'));
    await request(app!.getHttpServer()).post('/webhooks/tiktok')
      .set('content-type', 'application/json').set('tiktok-signature', signed.header).send(signed.raw).expect(200);
    expect(register).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed supported events and ignores authentic unsupported events', async () => {
    const malformed = signedBody({ ...payload, content: '{}' });
    await request(app!.getHttpServer()).post('/webhooks/tiktok')
      .set('content-type', 'application/json').set('tiktok-signature', malformed.header).send(malformed.raw).expect(400);

    const unsupported = signedBody({ ...payload, event: 'im_auto_message_update' });
    await request(app!.getHttpServer()).post('/webhooks/tiktok')
      .set('content-type', 'application/json').set('tiktok-signature', unsupported.header).send(unsupported.raw).expect(200);
    expect(register).not.toHaveBeenCalled();
  });
});
