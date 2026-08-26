import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient } from '@autosale/database';
import { DynamicModule, Module } from '@nestjs/common';

import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';

@Module({})
export class OrdersModule {
  static register(env: ApiEnv): DynamicModule {
    return { module: OrdersModule, controllers: [OrdersController], providers: [{ provide: OrdersService, useFactory: () => new OrdersService(createPrismaClient(env.DATABASE_URL), env.DEFAULT_TENANT_ID) }] };
  }
}
