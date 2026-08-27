import { describe, expect, it } from 'vitest';

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

  it('creates an expiring Redis counter on the first attempt', async () => {
    const commands: Array<[string, ...unknown[]]> = [];
    const redis = {
      incr: async (key: string) => { commands.push(['incr', key]); return 1; },
      expire: async (key: string, seconds: number) => { commands.push(['expire', key, seconds]); return 1; },
    };

    await expect(new RedisRateLimitStore(redis).increment('bounded-key', 60)).resolves.toBe(1);
    expect(commands).toEqual([['incr', 'bounded-key'], ['expire', 'bounded-key', 60]]);
  });

  it('fails closed with 503 when the rate-limit store is unavailable', async () => {
    const unavailable: RateLimitStore = { increment: async () => { throw new Error('redis unavailable'); } };
    const limiter = new RateLimitService(unavailable, 'r'.repeat(32));

    await expect(limiter.consume('login', '127.0.0.0/24', 'owner@example.com', 5, 60))
      .rejects.toMatchObject({ status: 503 });
  });
});
