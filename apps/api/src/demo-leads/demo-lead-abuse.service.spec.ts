import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { describe, expect, it, vi } from 'vitest';

import { DemoLeadAbuseService, RedisDemoLeadQuotaStore, type DemoLeadQuotaStore } from './demo-lead-abuse.service.js';

class AtomicMemoryQuotaStore implements DemoLeadQuotaStore {
  private readonly counters = new Map<string, { count: number; expiresAt: number }>();
  constructor(private readonly now: () => number) {}

  async consume(ipKey: string, contactKey: string, ipLimit: number, contactLimit: number, ipWindow: number, contactWindow: number) {
    const read = (key: string) => {
      const value = this.counters.get(key);
      return value && value.expiresAt > this.now() ? value : undefined;
    };
    const ip = read(ipKey);
    const contact = read(contactKey);
    if ((ip?.count ?? 0) >= ipLimit) return { allowed: false as const, retryAfterSeconds: Math.ceil((ip!.expiresAt - this.now()) / 1000) };
    if ((contact?.count ?? 0) >= contactLimit) return { allowed: false as const, retryAfterSeconds: Math.ceil((contact!.expiresAt - this.now()) / 1000) };
    this.counters.set(ipKey, { count: (ip?.count ?? 0) + 1, expiresAt: ip?.expiresAt ?? this.now() + ipWindow * 1000 });
    this.counters.set(contactKey, { count: (contact?.count ?? 0) + 1, expiresAt: contact?.expiresAt ?? this.now() + contactWindow * 1000 });
    return { allowed: true as const };
  }
}

const request = (ipPrefix: string, contact: string, idempotencyKey: string) => ({ ipPrefix, contact, idempotencyKey });

describe('DemoLeadAbuseService', () => {
  it('uses one atomic Redis operation with opaque keys and a bounded retry time', async () => {
    const evalCommand = vi.fn().mockResolvedValue([0, 599]);
    const limiter = new DemoLeadAbuseService(new RedisDemoLeadQuotaStore({ eval: evalCommand }), 'p'.repeat(32));
    await expect(limiter.check(request('192.0.2.0/24', 'a@example.test', 'key'))).rejects.toMatchObject({ status: 429, retryAfterSeconds: 599 });
    expect(evalCommand).toHaveBeenCalledTimes(1);
    const [script, keyCount, ipKey, contactKey, ipLimit, contactLimit, ipWindow, contactWindow] = evalCommand.mock.calls[0]!;
    expect(script).toContain('INCR');
    expect(keyCount).toBe(2);
    expect(`${ipKey}${contactKey}`).not.toContain('192.0.2');
    expect(`${ipKey}${contactKey}`).not.toContain('a@example.test');
    expect([ipLimit, contactLimit, ipWindow, contactWindow]).toEqual([10, 3, 600, 86_400]);
  });

  it('blocks the eleventh new request from an IP even when contacts vary', async () => {
    let now = 0;
    const limiter = new DemoLeadAbuseService(new AtomicMemoryQuotaStore(() => now), 'p'.repeat(32));
    for (let i = 0; i < 10; i += 1) await expect(limiter.check(request('192.0.2.0/24', `lead${i}@example.test`, `key-${i}`))).resolves.toBeUndefined();
    await expect(limiter.check(request('192.0.2.0/24', 'another@example.test', 'key-11'))).rejects.toMatchObject({ status: 429 });
    now += 600_001;
    await expect(limiter.check(request('192.0.2.0/24', 'another@example.test', 'key-12'))).resolves.toBeUndefined();
  });

  it('blocks the fourth new request for one normalized contact across IPs', async () => {
    const limiter = new DemoLeadAbuseService(new AtomicMemoryQuotaStore(() => 0), 'p'.repeat(32));
    for (let i = 0; i < 3; i += 1) await expect(limiter.check(request(`192.0.${i}.0/24`, '  A@Example.Test ', `key-${i}`))).resolves.toBeUndefined();
    await expect(limiter.check(request('198.51.100.0/24', 'a@example.test', 'key-4'))).rejects.toMatchObject({ status: 429 });
  });

  it('treats formatting variants of one phone as the same contact', async () => {
    const limiter = new DemoLeadAbuseService(new AtomicMemoryQuotaStore(() => 0), 'p'.repeat(32));
    for (let i = 0; i < 3; i += 1) await limiter.check(request(`192.0.${i}.0/24`, i % 2 ? '+380 (67) 123-45-67' : '380671234567', `phone-${i}`));
    await expect(limiter.check(request('198.51.100.0/24', '+380 67 123 45 67', 'phone-4'))).rejects.toMatchObject({ status: 429 });
  });

  it('does not leave a half-consumed contact quota when an IP is blocked', async () => {
    const limiter = new DemoLeadAbuseService(new AtomicMemoryQuotaStore(() => 0), 'p'.repeat(32));
    for (let i = 0; i < 10; i += 1) await limiter.check(request('192.0.2.0/24', `unique${i}@example.test`, `key-${i}`));
    await expect(limiter.check(request('192.0.2.0/24', 'fresh@example.test', 'blocked'))).rejects.toMatchObject({ status: 429 });
    await expect(limiter.check(request('198.51.100.0/24', 'fresh@example.test', 'allowed'))).resolves.toBeUndefined();
  });

  it('fails closed without exposing the Redis failure', async () => {
    const store: DemoLeadQuotaStore = { consume: async () => { throw new Error('redis://secret@internal'); } };
    await expect(new DemoLeadAbuseService(store, 'p'.repeat(32)).check(request('192.0.2.0/24', 'a@example.test', 'key')))
      .rejects.toMatchObject({ status: 503 });
  });
});
describe.runIf(Boolean(process.env.DEMO_TEST_REDIS_URL))('RedisDemoLeadQuotaStore against disposable Redis', () => {
  it('admits only ten simultaneous IP requests and lets both windows expire', async () => {
    const redis = new Redis(process.env.DEMO_TEST_REDIS_URL!, { maxRetriesPerRequest: 1 });
    const store = new RedisDemoLeadQuotaStore(redis);
    const nonce = randomUUID();
    try {
      const results = await Promise.all(Array.from({ length: 20 }, (_, i) => store.consume(`test-ip:${nonce}`, `test-contact:${nonce}:${i}`, 10, 3, 1, 1)));
      expect(results.filter((result) => result.allowed)).toHaveLength(10);
      expect(results.filter((result) => !result.allowed)).toHaveLength(10);
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      await expect(store.consume(`test-ip:${nonce}`, `test-contact:${nonce}:21`, 10, 3, 1, 1)).resolves.toEqual({ allowed: true });
    } finally {
      await redis.quit();
    }
  });

  it('fails closed when an established Redis connection is lost', async () => {
    const redis = new Redis(process.env.DEMO_TEST_REDIS_URL!, { maxRetriesPerRequest: 1 });
    const limiter = new DemoLeadAbuseService(new RedisDemoLeadQuotaStore(redis), 'p'.repeat(32));
    try {
      await redis.ping();
      redis.disconnect();
      await expect(limiter.check(request('192.0.2.0/24', 'fictional@example.test', randomUUID())))
        .rejects.toMatchObject({ status: 503, message: 'DEMO_RATE_LIMITER_UNAVAILABLE' });
    } finally {
      redis.disconnect();
    }
  });
});
