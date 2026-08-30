import { createHmac } from 'node:crypto';
import { HttpException, HttpStatus, ServiceUnavailableException } from '@nestjs/common';

export interface RateLimitStore {
  increment(key: string, windowSeconds: number): Promise<number>;
}

export interface RedisCounterClient {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly redis: RedisCounterClient) {}

  async increment(key: string, windowSeconds: number): Promise<number> {
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, windowSeconds);
    return count;
  }
}

export class RateLimitExceededError extends HttpException {
  constructor() { super('Rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS); }
}

export class RateLimitService {
  constructor(private readonly store: RateLimitStore, private readonly pepper: string) {}

  async consume(route: string, ipPrefix: string, email: string, limit: number, windowSeconds: number): Promise<void> {
    const identity = createHmac('sha256', this.pepper).update(`${ipPrefix}\0${email.trim().toLowerCase()}`).digest('hex');
    let count: number;
    try {
      count = await this.store.increment(`auth-rate:${route}:${identity}`, windowSeconds);
    } catch {
      throw new ServiceUnavailableException('Authentication rate limiter unavailable');
    }
    if (count > limit) throw new RateLimitExceededError();
  }
}
