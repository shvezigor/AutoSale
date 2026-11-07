import { describe, expect, it, vi } from 'vitest';

import { RateLimitExceededError, RateLimitService, RedisRateLimitStore, type RateLimitStore } from './rate-limit.service.js';

class MemoryStore implements RateLimitStore {
  private readonly values = new Map<string, number>();
  async increment(key: string, _windowSeconds: number): Promise<number> {
    const next = (this.values.get(key) ?? 0) + 1;
    this.values.set(key, next);
    return next;
  }
}

describe('RateLimitService', () => {
  it('blocks the sixth attempt in one bounded login window', async () => {
    const limiter = new RateLimitService(new MemoryStore(), 'r'.repeat(32));
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expect(limiter.consume('login', '127.0.0.0/24', 'owner@example.com', 5, 60)).resolves.toBeUndefined();
    }
    await expect(limiter.consume('login', '127.0.0.0/24', 'owner@example.com', 5, 60)).rejects.toBeInstanceOf(RateLimitExceededError);
  });

  it('keeps an authenticated user budget when the IP address changes', async () => {
    const limiter = new RateLimitService(new MemoryStore(), 'r'.repeat(32));
    const userId = '00000000-0000-4000-8000-000000000001';
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await limiter.consumeUser('account-delete-reauth-user', userId, 5, 900);
      await limiter.consume('account-delete-reauth', `192.0.2.${attempt}`, 'owner@example.invalid', 5, 900);
    }
    await expect(limiter.consumeUser('account-delete-reauth-user', userId, 5, 900))
      .rejects.toBeInstanceOf(RateLimitExceededError);
  });

  it('increments and sets expiry in one Redis operation', async () => {
    const redis = { eval: vi.fn().mockResolvedValue(1) };
    await expect(new RedisRateLimitStore(redis).increment('bounded-key', 60)).resolves.toBe(1);
    expect(redis.eval).toHaveBeenCalledOnce();
    const [script, keys, key, seconds] = redis.eval.mock.calls[0]!;
    expect(script).toContain("redis.call('INCR', KEYS[1])");
    expect(script).toContain("redis.call('TTL', KEYS[1]) < 0");
    expect(script).toContain("redis.call('EXPIRE', KEYS[1], ARGV[1])");
    expect([keys, key, seconds]).toEqual([1, 'bounded-key', 60]);
  });

  it('rejects an invalid Redis counter response', async () => {
    const redis = { eval: vi.fn().mockResolvedValue('unexpected') };
    await expect(new RedisRateLimitStore(redis).increment('bounded-key', 60))
      .rejects.toThrow('Invalid Redis rate-limit counter');
  });

  it('fails closed with 503 when the rate-limit store is unavailable', async () => {
    const unavailable: RateLimitStore = { increment: async () => { throw new Error('redis unavailable'); } };
    const limiter = new RateLimitService(unavailable, 'r'.repeat(32));

    await expect(limiter.consume('login', '127.0.0.0/24', 'owner@example.com', 5, 60))
      .rejects.toMatchObject({ status: 503 });
  });
});
