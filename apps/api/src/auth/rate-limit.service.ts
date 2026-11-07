import { createHmac } from 'node:crypto';
import { HttpException, HttpStatus, ServiceUnavailableException } from '@nestjs/common';

export interface RateLimitStore {
  increment(key: string, windowSeconds: number): Promise<number>;
}

export interface RedisCounterClient {
  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

const INCREMENT_WITH_EXPIRY = `
local count = redis.call('INCR', KEYS[1])
if redis.call('TTL', KEYS[1]) < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
`;

export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly redis: RedisCounterClient) {}

  async increment(key: string, windowSeconds: number): Promise<number> {
    const count = await this.redis.eval(INCREMENT_WITH_EXPIRY, 1, key, windowSeconds);
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1) {
      throw new Error('Invalid Redis rate-limit counter');
    }
    return count;
  }
}

export class RateLimitExceededError extends HttpException {
  constructor() { super('Rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS); }
}

export class RateLimitService {
  constructor(private readonly store: RateLimitStore, private readonly pepper: string) {}

  async consume(route: string, ipPrefix: string, email: string, limit: number, windowSeconds: number): Promise<void> {
    await this.consumeKey(route, `${ipPrefix}\0${email.trim().toLowerCase()}`, limit, windowSeconds);
  }

  /** A second, IP-independent budget for sensitive actions by an authenticated user. */
  async consumeUser(route: string, userId: string, limit: number, windowSeconds: number): Promise<void> {
    await this.consumeKey(route, `user\0${userId}`, limit, windowSeconds);
  }

  private async consumeKey(route: string, material: string, limit: number, windowSeconds: number): Promise<void> {
    const identity = createHmac('sha256', this.pepper).update(material).digest('hex');
    let count: number;
    try {
      count = await this.store.increment(`auth-rate:${route}:${identity}`, windowSeconds);
    } catch {
      throw new ServiceUnavailableException('Authentication rate limiter unavailable');
    }
    if (count > limit) throw new RateLimitExceededError();
  }
}
