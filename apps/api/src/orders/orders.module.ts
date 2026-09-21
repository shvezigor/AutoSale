import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient, ProcurementStore } from '@autosale/database';
import { DynamicModule, Module } from '@nestjs/common';

import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { CommercialTermsController } from './commercial-terms.controller.js';
import { CommercialTermsService } from './commercial-terms.service.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';

@Module({})
export class OrdersModule {
  static register(env: ApiEnv): DynamicModule {
    return {
      module: OrdersModule,
      controllers: [OrdersController, CommercialTermsController, PaymentsController],
      providers: [
        {
          provide: OrdersService,
          useFactory: () => {
            const prisma = createPrismaClient(env.DATABASE_URL);
            return new OrdersService(prisma, new ProcurementStore(prisma));
          },
        },
        { provide: CommercialTermsService, useFactory: () => new CommercialTermsService(createPrismaClient(env.DATABASE_URL)) },
        { provide: PaymentsService, useFactory: () => new PaymentsService(createPrismaClient(env.DATABASE_URL)) },
      ],
    };
  }
}
