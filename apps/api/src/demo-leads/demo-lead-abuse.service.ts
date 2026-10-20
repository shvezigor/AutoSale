import { createHmac } from 'node:crypto';
import { HttpException, HttpStatus, ServiceUnavailableException } from '@nestjs/common';

export interface DemoLeadQuotaStore {
  consume(ipKey: string, contactKey: string, ipLimit: number, contactLimit: number, ipWindowSeconds: number, contactWindowSeconds: number): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }>;
}

export interface RedisScriptClient {
  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

const CONSUME_QUOTAS = `
local ip_count = tonumber(redis.call('GET', KEYS[1]) or '0')
local contact_count = tonumber(redis.call('GET', KEYS[2]) or '0')
if ip_count >= tonumber(ARGV[1]) then
  return {0, math.max(1, redis.call('TTL', KEYS[1]))}
end
if contact_count >= tonumber(ARGV[2]) then
  return {0, math.max(1, redis.call('TTL', KEYS[2]))}
end
if redis.call('INCR', KEYS[1]) == 1 then redis.call('EXPIRE', KEYS[1], ARGV[3]) end
if redis.call('INCR', KEYS[2]) == 1 then redis.call('EXPIRE', KEYS[2], ARGV[4]) end
return {1, 0}
`;

export class RedisDemoLeadQuotaStore implements DemoLeadQuotaStore {
  constructor(private readonly redis: RedisScriptClient) {}

  async consume(ipKey: string, contactKey: string, ipLimit: number, contactLimit: number, ipWindowSeconds: number, contactWindowSeconds: number) {
    const result = await this.redis.eval(CONSUME_QUOTAS, 2, ipKey, contactKey, ipLimit, contactLimit, ipWindowSeconds, contactWindowSeconds);
    if (!Array.isArray(result) || result.length !== 2 || !result.every((part) => typeof part === 'number')) {
      throw new Error('Invalid quota-store result');
    }
    return result[0] === 1
      ? { allowed: true as const }
      : { allowed: false as const, retryAfterSeconds: Math.max(1, result[1] as number) };
  }
}

export class DemoLeadQuotaExceededError extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super('DEMO_RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS);
  }
}

export class DemoLeadAbuseService {
  constructor(private readonly store: DemoLeadQuotaStore, private readonly pepper: string) {}

  async check(input: { ipPrefix: string; contact: string; idempotencyKey: string }): Promise<void> {
    const key = (kind: string, value: string) => `demo-rate:${kind}:${createHmac('sha256', this.pepper).update(`${kind}\0${value}`).digest('hex')}`;
    const trimmedContact = input.contact.trim();
    const contact = trimmedContact.includes('@') ? trimmedContact.toLowerCase() : trimmedContact.replace(/\D/g, '');
    let result: Awaited<ReturnType<DemoLeadQuotaStore['consume']>>;
    try {
      result = await this.store.consume(key('ip', input.ipPrefix), key('contact', contact), 10, 3, 600, 86_400);
    } catch {
      throw new ServiceUnavailableException('DEMO_RATE_LIMITER_UNAVAILABLE');
    }
    if (!result.allowed) throw new DemoLeadQuotaExceededError(Math.max(1, result.retryAfterSeconds));
  }
}
