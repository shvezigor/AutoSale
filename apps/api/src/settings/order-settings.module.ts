import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient } from '@autosale/database';
import { createGoogleSheetsAdapter } from '@autosale/integrations';
import { DynamicModule, Module } from '@nestjs/common';

import { OrderSettingsController } from './order-settings.controller.js';
import { OrderSettingsService } from './order-settings.service.js';
import { GoogleSheetsSettingsController } from './google-sheets-settings.controller.js';
import { GoogleSheetsSettingsService } from './google-sheets-settings.service.js';

@Module({})
export class OrderSettingsModule {
  static register(env: ApiEnv): DynamicModule {
    return {
      module: OrderSettingsModule,
      controllers: [OrderSettingsController, GoogleSheetsSettingsController],
      providers: [
        {
          provide: OrderSettingsService,
          useFactory: () =>
            new OrderSettingsService(createPrismaClient(env.DATABASE_URL), env.DEFAULT_TENANT_ID),
        },
        {
          provide: GoogleSheetsSettingsService,
          useFactory: () => new GoogleSheetsSettingsService(createPrismaClient(env.DATABASE_URL), env.DEFAULT_TENANT_ID, env.GOOGLE_SERVICE_ACCOUNT_FILE ? createGoogleSheetsAdapter(env.GOOGLE_SERVICE_ACCOUNT_FILE) : undefined),
        },
      ],
    };
  }
}
