import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient } from '@autosale/database';
import { type DynamicModule, Module } from '@nestjs/common';

import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

@Module({})
export class DashboardModule {
  static register(env: ApiEnv): DynamicModule {
    return {
      module: DashboardModule,
      controllers: [DashboardController],
      providers: [{ provide: DashboardService, useFactory: () => new DashboardService(createPrismaClient(env.DATABASE_URL)) }],
    };
  }
}
