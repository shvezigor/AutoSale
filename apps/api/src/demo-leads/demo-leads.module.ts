import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient } from '@autosale/database';
import { DynamicModule, Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';

import { DemoLeadAbuseService, RedisDemoLeadQuotaStore } from './demo-lead-abuse.service.js';
import { DemoLeadsController } from './demo-leads.controller.js';
import { DemoLeadsService } from './demo-leads.service.js';

@Module({})
export class DemoLeadsModule {
  static register(env: ApiEnv): DynamicModule {
    const url = new URL(env.REDIS_URL);
    const queue = new Queue('demo-leads', { connection: {
      host: url.hostname,
      port: Number(url.port || 6379),
      username: url.username || undefined,
      password: url.password || undefined,
      tls: url.protocol === 'rediss:' ? {} : undefined,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 1_500,
      commandTimeout: 1_500,
    } });
    const redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 1_500, commandTimeout: 1_500 });
    return { module: DemoLeadsModule, controllers: [DemoLeadsController], providers: [
      { provide: DemoLeadsService, useFactory: () => new DemoLeadsService(createPrismaClient(env.DATABASE_URL), queue) },
      { provide: DemoLeadAbuseService, useValue: new DemoLeadAbuseService(new RedisDemoLeadQuotaStore(redis), env.AUTH_TOKEN_PEPPER) },
    ] };
  }
}
