import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient } from '@autosale/database';
import { DynamicModule, Module } from '@nestjs/common';

import { CommercialSettingsController } from './commercial-settings.controller.js';
import { CommercialSettingsService } from './commercial-settings.service.js';

@Module({})
export class CommercialSettingsModule {
  static register(env: ApiEnv): DynamicModule {
    return {
      module: CommercialSettingsModule,
      controllers: [CommercialSettingsController],
      providers: [{
        provide: CommercialSettingsService,
        useFactory: () => new CommercialSettingsService(createPrismaClient(env.DATABASE_URL)),
      }],
    };
  }
}
