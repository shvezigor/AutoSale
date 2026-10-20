import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient } from '@autosale/database';
import { DynamicModule, Module } from '@nestjs/common';
import Redis from 'ioredis';

import { ConversionController } from './conversion.controller.js';
import { ConversionService } from './conversion.service.js';
import { TenantPlanInterestController } from './tenant-plan-interest.controller.js';

@Module({})
export class ConversionModule {
  static register(env: ApiEnv): DynamicModule {
    const redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 1_500, commandTimeout: 1_500 });
    return { module: ConversionModule, controllers: [ConversionController, TenantPlanInterestController], providers: [
      { provide: ConversionService, useValue: new ConversionService(createPrismaClient(env.DATABASE_URL), redis, env.AUTH_TOKEN_PEPPER, env.MARKETING_ANALYTICS_ENABLED) },
    ] };
  }
}
