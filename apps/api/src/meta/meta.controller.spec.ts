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
  const resolveTenant = vi.fn();
  const add = vi.fn();

  beforeEach(async () => {
    rawBody = await readFile(
      resolve(process.cwd(), '../../tests/fixtures/meta/text-message.json'),
    );
    fixture = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    register.mockReset().mockResolvedValue({ eventId: 'event-1', duplicate: false, pending: true });
    resolveTenant.mockReset().mockResolvedValue(tenantId);
    add.mockReset().mockResolvedValue(undefined);

    const config: MetaWebhookConfig = { verifyToken };
    const moduleRef = await Test.createTestingModule({
      controllers: [MetaController],
      providers: [
        { provide: META_WEBHOOK_CONFIG, useValue: config },
        { provide: MetaSignatureService, useValue: new MetaSignatureService(appSecret) },
        { provide: MetaEventService, useValue: { register, resolveTenant } },
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
    expect(add).toHaveBeenCalledWith(
      'instagram.normalize',
      { eventId: 'event-1', correlationId: 'event-1' },
      { jobId: 'event-1', removeOnFail: true },
    );
    expect(resolveTenant).toHaveBeenCalledWith('17841400000000000');
  });

  it('routes every entry through its own Instagram account and tenant', async () => {
    const firstEntry = (fixture.entry as unknown[])[0]!;
    const secondTenantId = '22222222-2222-4222-8222-222222222222';
    const secondEntry = {
      id: '17841400000000001',
      time: 1787731201000,
      messaging: [
        {
          sender: { id: 'ig-user-200' },
          recipient: { id: '17841400000000001' },
          timestamp: 1787731201123,
          message: { mid: 'm_text_002', text: 'Second tenant' },
        },
      ],
    };
    const multiEntryPayload = {
      object: 'instagram',
      entry: [firstEntry, secondEntry],
    };
    resolveTenant.mockImplementation(async (accountId: string) =>
      accountId === '17841400000000000' ? tenantId : secondTenantId,
    );
    register
      .mockResolvedValueOnce({ eventId: 'event-1', duplicate: false, pending: true })
      .mockResolvedValueOnce({ eventId: 'event-2', duplicate: false, pending: true });
    const sentBody = Buffer.from(JSON.stringify(multiEntryPayload));
    const signature = `sha256=${createHmac('sha256', appSecret).update(sentBody).digest('hex')}`;

    await request(app!.getHttpServer())
      .post('/webhooks/meta')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signature)
      .send(multiEntryPayload)
      .expect(200, { received: true });

    expect(register).toHaveBeenNthCalledWith(1, {
      tenantId,
      externalEventId: 'm_text_001',
      payload: { object: 'instagram', entry: [firstEntry] },
    });
    expect(register).toHaveBeenNthCalledWith(2, {
      tenantId: secondTenantId,
      externalEventId: 'm_text_002',
      payload: { object: 'instagram', entry: [secondEntry] },
    });
    expect(add).toHaveBeenCalledTimes(2);
    expect(add).toHaveBeenNthCalledWith(
      2,
      'instagram.normalize',
      { eventId: 'event-2', correlationId: 'event-2' },
      { jobId: 'event-2', removeOnFail: true },
    );
  });

  it('acknowledges an unknown account without assigning it to another tenant', async () => {
    resolveTenant.mockResolvedValue(null);
    const sentBody = Buffer.from(JSON.stringify(fixture));
    const signature = `sha256=${createHmac('sha256', appSecret).update(sentBody).digest('hex')}`;
    await request(app!.getHttpServer()).post('/webhooks/meta').set('Content-Type', 'application/json').set('X-Hub-Signature-256', signature).send(fixture).expect(200, { received: true });
    expect(register).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('skips an unknown account entry while accepting a known account entry', async () => {
    const unknownEntry = { id: 'unknown-account', time: 1787731200000, messaging: [] };
    const knownEntry = (fixture.entry as unknown[])[0]!;
    const payload = { object: 'instagram', entry: [unknownEntry, knownEntry] };
    resolveTenant.mockImplementation(async (accountId: string) =>
      accountId === '17841400000000000' ? tenantId : null,
    );
    const sentBody = Buffer.from(JSON.stringify(payload));
    const signature = `sha256=${createHmac('sha256', appSecret).update(sentBody).digest('hex')}`;

    await request(app!.getHttpServer())
      .post('/webhooks/meta')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signature)
      .send(payload)
      .expect(200, { received: true });

    expect(resolveTenant).toHaveBeenNthCalledWith(1, 'unknown-account');
    expect(resolveTenant).toHaveBeenNthCalledWith(2, '17841400000000000');
    expect(register).toHaveBeenCalledOnce();
    expect(register.mock.calls[0]![0]).toMatchObject({
      tenantId,
      payload: { object: 'instagram', entry: [knownEntry] },
    });
  });

  it.each([
    [{ object: 'page', entry: [] }, 'a non-Instagram object'],
    [{ object: 'instagram' }, 'a missing entry array'],
    [{ object: 'instagram', entry: [{ messaging: [] }] }, 'an entry without an account id'],
  ])('rejects %s before tenant resolution (%s)', async (payload, _description) => {
    const sentBody = Buffer.from(JSON.stringify(payload));
    const signature = `sha256=${createHmac('sha256', appSecret).update(sentBody).digest('hex')}`;

    await request(app!.getHttpServer())
      .post('/webhooks/meta')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signature)
      .send(payload)
      .expect(400);

    expect(resolveTenant).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
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

  it('acknowledges a processed replay without enqueueing it again', async () => {
    register.mockResolvedValue({ eventId: 'event-1', duplicate: true, pending: false });
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

  it('acknowledges a queue outage and safely re-enqueues the pending event on Meta retry', async () => {
    register
      .mockResolvedValueOnce({ eventId: 'event-1', duplicate: false, pending: true })
      .mockResolvedValueOnce({ eventId: 'event-1', duplicate: true, pending: true });
    add.mockRejectedValueOnce(new Error('redis unavailable')).mockResolvedValueOnce(undefined);
    const sentBody = Buffer.from(JSON.stringify(fixture));
    const signature = `sha256=${createHmac('sha256', appSecret).update(sentBody).digest('hex')}`;

    for (let delivery = 0; delivery < 2; delivery += 1) {
      await request(app!.getHttpServer())
        .post('/webhooks/meta')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', signature)
        .send(fixture)
        .expect(200, { received: true });
    }

    expect(register).toHaveBeenCalledTimes(2);
    expect(add).toHaveBeenCalledTimes(2);
    expect(add.mock.calls[0]).toEqual(add.mock.calls[1]);
  });

  it('acknowledges after durable registration without waiting for Redis dispatch', async () => {
    let finishDispatch: (() => void) | undefined;
    add.mockReturnValueOnce(new Promise<void>((resolveDispatch) => {
      finishDispatch = resolveDispatch;
    }));
    const sentBody = Buffer.from(JSON.stringify(fixture));
    const signature = `sha256=${createHmac('sha256', appSecret).update(sentBody).digest('hex')}`;
    const response = request(app!.getHttpServer())
      .post('/webhooks/meta')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signature)
      .send(fixture)
      .then(() => 'acknowledged' as const);

    const outcome = await Promise.race([
      response,
      new Promise<'waiting-for-queue'>((resolveTimeout) =>
        setTimeout(() => resolveTimeout('waiting-for-queue'), 100),
      ),
    ]);
    finishDispatch?.();
    await response;

    expect(outcome).toBe('acknowledged');
  });
});
