import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient } from '@autosale/database';
import { DynamicModule, Module } from '@nestjs/common';
import { Queue } from 'bullmq';

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
    } });
    return { module: DemoLeadsModule, controllers: [DemoLeadsController], providers: [{ provide: DemoLeadsService, useFactory: () => new DemoLeadsService(createPrismaClient(env.DATABASE_URL), queue) }] };
  }
}
