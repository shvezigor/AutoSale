import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient, ProcurementStore } from '@autosale/database';
import { DynamicModule, Module } from '@nestjs/common';

import { CatalogueService } from '../catalogue/catalogue.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { SearchController } from './search.controller.js';
import { SearchService } from './search.service.js';

@Module({})
export class SearchModule {
  static register(env: ApiEnv): DynamicModule {
    return {
      module: SearchModule,
      controllers: [SearchController],
      providers: [{
        provide: SearchService,
        useFactory: () => {
          const prisma = createPrismaClient(env.DATABASE_URL);
          return new SearchService(
            new OrdersService(prisma, new ProcurementStore(prisma)),
            new CatalogueService(prisma),
          );
        },
      }],
    };
  }
}
