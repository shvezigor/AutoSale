import { createHmac } from 'node:crypto';

import type { ConversionEvent } from '@autosale/contracts';
import type { PrismaClient } from '@autosale/database';
import { HttpException, HttpStatus, ServiceUnavailableException } from '@nestjs/common';

export interface ConversionQuotaClient {
  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

const CONSUME = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if count >= tonumber(ARGV[1]) then return {0, math.max(1, redis.call('TTL', KEYS[1]))} end
if redis.call('INCR', KEYS[1]) == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
return {1, 0}
`;

export class ConversionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: ConversionQuotaClient,
    private readonly pepper: string,
    private readonly enabled: boolean,
  ) {}

  async recordAnonymous(event: ConversionEvent, clientIp: string): Promise<void> {
    if (!this.enabled) return;
    const key = `conversion-rate:${createHmac('sha256', this.pepper).update(`ip\0${clientIp}`).digest('hex')}`;
    let result: unknown;
    try { result = await this.redis.eval(CONSUME, 1, key, 60, 3600); }
    catch { throw new ServiceUnavailableException('CONVERSION_RATE_LIMITER_UNAVAILABLE'); }
    if (!Array.isArray(result) || result.length !== 2 || !result.every((part) => typeof part === 'number')) {
      throw new ServiceUnavailableException('CONVERSION_RATE_LIMITER_UNAVAILABLE');
    }
    if (result[0] !== 1) throw new HttpException('CONVERSION_RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS);
    await this.prisma.$queryRaw`
      SELECT public.api_increment_marketing_counter(${event.event}, ${event.locale}, ${event.event === 'plan_interest' ? event.planId : 'none'})
    `;
  }
}
