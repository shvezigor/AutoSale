import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { INSTAGRAM_NORMALIZE_QUEUE } from '../queue/queue.module.js';
import { MetaEventService } from './meta-event.service.js';
import {
  META_WEBHOOK_CONFIG,
  MetaController,
  type MetaWebhookConfig,
} from './meta.controller.js';
import { MetaSignatureService } from './meta-signature.service.js';

const appSecret = 'meta-app-secret-value';
const verifyToken = 'verify-token-with-24-characters';
const tenantId = '11111111-1111-4111-8111-111111111111';

describe('MetaController', () => {
  let app: INestApplication | undefined;
  let rawBody: Buffer;
  let fixture: Record<string, unknown>;
  const register = vi.fn();
  const add = vi.fn();

  beforeEach(async () => {
    rawBody = await readFile(
      resolve(process.cwd(), '../../tests/fixtures/meta/text-message.json'),
    );
    fixture = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    register.mockReset().mockResolvedValue({ eventId: 'event-1', duplicate: false });
    add.mockReset().mockResolvedValue(undefined);

    const config: MetaWebhookConfig = { tenantId, verifyToken };
    const moduleRef = await Test.createTestingModule({
      controllers: [MetaController],
      providers: [
        { provide: META_WEBHOOK_CONFIG, useValue: config },
        { provide: MetaSignatureService, useValue: new MetaSignatureService(appSecret) },
        { provide: MetaEventService, useValue: { register } },
        { provide: INSTAGRAM_NORMALIZE_QUEUE, useValue: { add } },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  it('completes Meta webhook verification', async () => {
    await request(app!.getHttpServer())
      .get('/webhooks/meta')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': verifyToken,
        'hub.challenge': '1234',
      })
      .expect(200, '1234');
  });

  it('rejects an invalid webhook verification token', async () => {
    await request(app!.getHttpServer())
      .get('/webhooks/meta')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong-token',
        'hub.challenge': '1234',
      })
      .expect(403);
  });

  it('durably registers a signed callback and enqueues normalization', async () => {
    const sentBody = Buffer.from(JSON.stringify(fixture));
    const signature = `sha256=${createHmac('sha256', appSecret).update(sentBody).digest('hex')}`;

    await request(app!.getHttpServer())
      .post('/webhooks/meta')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signature)
      .send(fixture)
      .expect(200, { received: true });

    expect(register).toHaveBeenCalledWith({
      tenantId,
      externalEventId: 'm_text_001',
      payload: fixture,
    });
    expect(add).toHaveBeenCalledWith('instagram.normalize', { eventId: 'event-1', correlationId: 'event-1' });
  });

  it('rejects an invalid signature without writing or enqueueing', async () => {
    await request(app!.getHttpServer())
      .post('/webhooks/meta')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', 'sha256=00')
      .send(fixture)
      .expect(401);

    expect(register).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('acknowledges a replay without enqueueing it again', async () => {
    register.mockResolvedValue({ eventId: 'event-1', duplicate: true });
    const sentBody = Buffer.from(JSON.stringify(fixture));
    const signature = `sha256=${createHmac('sha256', appSecret).update(sentBody).digest('hex')}`;

    await request(app!.getHttpServer())
      .post('/webhooks/meta')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signature)
      .send(fixture)
      .expect(200, { received: true });

    expect(register).toHaveBeenCalledOnce();
    expect(add).not.toHaveBeenCalled();
  });
});
