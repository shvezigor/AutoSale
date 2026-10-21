import { randomUUID } from 'node:crypto';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { DemoLeadAbuseService, RedisDemoLeadQuotaStore } from './demo-lead-abuse.service.js';
import { DemoLeadsController } from './demo-leads.controller.js';
import { DemoLeadsService } from './demo-leads.service.js';

describe.runIf(Boolean(process.env.DEMO_TEST_REDIS_URL))('demo lead HTTP quota against disposable Redis', () => {
  it('returns a real Retry-After, preserves accepted replays, and fails closed on connection loss', async () => {
    const redis = new Redis(process.env.DEMO_TEST_REDIS_URL!, { maxRetriesPerRequest: 1 });
    const accepted = new Map<string, { id: string; accepted: true }>();
    const leads = {
      findAccepted: vi.fn(async (key: string) => accepted.get(key) ?? null),
      create: vi.fn(async (_input: unknown, key: string) => {
        const result = { id: randomUUID(), accepted: true as const };
        accepted.set(key, result);
        return result;
      }),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [DemoLeadsController],
      providers: [
        { provide: DemoLeadsService, useValue: leads },
        { provide: DemoLeadAbuseService, useValue: new DemoLeadAbuseService(new RedisDemoLeadQuotaStore(redis), randomUUID()) },
      ],
    }).compile();
    const app: INestApplication = moduleRef.createNestApplication();
    await app.init();
    try {
      const contact = `fictional-${randomUUID()}@example.test`;
      const body = { name: 'Fictional Person', company: 'Fictional Store', email: contact, phone: '', orderVolume: '50_TO_300', note: '', locale: 'en', privacyConsent: true };
      const keys = Array.from({ length: 4 }, () => randomUUID());
      const post = (key: string, payload = body) => request(app.getHttpServer()).post('/api/demo-leads').set('Idempotency-Key', key).send(payload);

      const first = await post(keys[0]!).expect(201);
      await post(keys[1]!).expect(201);
      await post(keys[2]!).expect(201);
      const limited = await post(keys[3]!).expect(429);
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
      expect(JSON.stringify(limited.body)).not.toContain(contact);
      expect((await post(keys[0]!).expect(201)).body).toEqual(first.body);
      expect(leads.create).toHaveBeenCalledTimes(3);

      redis.disconnect();
      const unavailable = await post(randomUUID(), { ...body, email: `other-${randomUUID()}@example.test` }).expect(503);
      expect(unavailable.body.message).toBe('DEMO_RATE_LIMITER_UNAVAILABLE');
      expect(leads.create).toHaveBeenCalledTimes(3);
    } finally {
      await app.close();
      redis.disconnect();
    }
  });
});

describe.runIf(Boolean(process.env.DEMO_TEST_REDIS_OUTAGE_URL))('demo lead HTTP quota after disposable Redis stops', () => {
  it('returns a safe 503 and never creates a lead when the Redis server is unreachable', async () => {
    const redis = new Redis(process.env.DEMO_TEST_REDIS_OUTAGE_URL!, {
      lazyConnect: true, connectTimeout: 500, maxRetriesPerRequest: 1, retryStrategy: () => null,
    });
    redis.on('error', () => undefined);
    const create = vi.fn();
    const moduleRef = await Test.createTestingModule({
      controllers: [DemoLeadsController],
      providers: [
        { provide: DemoLeadsService, useValue: { findAccepted: vi.fn().mockResolvedValue(null), create } },
        { provide: DemoLeadAbuseService, useValue: new DemoLeadAbuseService(new RedisDemoLeadQuotaStore(redis), randomUUID()) },
      ],
    }).compile();
    const app: INestApplication = moduleRef.createNestApplication();
    await app.init();
    try {
      const contact = `fictional-${randomUUID()}@example.test`;
      const response = await request(app.getHttpServer()).post('/api/demo-leads')
        .set('Idempotency-Key', randomUUID())
        .send({ name: 'Fictional Person', company: 'Fictional Store', email: contact, phone: '', orderVolume: '50_TO_300', note: '', locale: 'en', privacyConsent: true })
        .expect(503);
      expect(response.body.message).toBe('DEMO_RATE_LIMITER_UNAVAILABLE');
      expect(JSON.stringify(response.body)).not.toContain(contact);
      expect(response.headers['retry-after']).toBeUndefined();
      expect(create).not.toHaveBeenCalled();
    } finally {
      await app.close();
      redis.disconnect();
    }
  });
});
