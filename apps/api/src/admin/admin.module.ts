import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient } from '@autosale/database';
import { DynamicModule, Module } from '@nestjs/common';

import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';

@Module({})
export class AdminModule {
  static register(env: ApiEnv): DynamicModule {
    return { module: AdminModule, controllers: [AdminController], providers: [{ provide: AdminService, useFactory: () => new AdminService(createPrismaClient(env.DATABASE_URL)) }] };
  }
}
