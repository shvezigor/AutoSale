import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient } from '@autosale/database';
import { DynamicModule, Global, Module } from '@nestjs/common';

import { NotificationsController } from './notifications.controller.js';
import { NotificationService } from './notifications.service.js';

@Global()
@Module({})
export class NotificationsModule {
  static register(env: ApiEnv): DynamicModule {
    return {
      global: true,
      module: NotificationsModule,
      controllers: [NotificationsController],
      providers: [{
        provide: NotificationService,
        useFactory: () => new NotificationService(createPrismaClient(env.DATABASE_URL) as never),
      }],
      exports: [NotificationService],
    };
  }
}
