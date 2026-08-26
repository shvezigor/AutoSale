import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient } from '@autosale/database';
import { DynamicModule, Module } from '@nestjs/common';

import { OrderSettingsController } from './order-settings.controller.js';
import { OrderSettingsService } from './order-settings.service.js';

@Module({})
export class OrderSettingsModule {
  static register(env: ApiEnv): DynamicModule {
    return {
      module: OrderSettingsModule,
      controllers: [OrderSettingsController],
      providers: [
        {
          provide: OrderSettingsService,
          useFactory: () =>
            new OrderSettingsService(createPrismaClient(env.DATABASE_URL), env.DEFAULT_TENANT_ID),
        },
      ],
    };
  }
}
