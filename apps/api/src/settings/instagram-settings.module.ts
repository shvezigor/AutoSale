import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient } from '@autosale/database';
import { DynamicModule, Module } from '@nestjs/common';
import { InstagramSettingsController } from './instagram-settings.controller.js';
import { InstagramSettingsService } from './instagram-settings.service.js';

@Module({})
export class InstagramSettingsModule {
  static register(env: ApiEnv): DynamicModule { return { module: InstagramSettingsModule, controllers: [InstagramSettingsController], providers: [{ provide: InstagramSettingsService, useValue: new InstagramSettingsService(createPrismaClient(env.DATABASE_URL)) }] }; }
}
