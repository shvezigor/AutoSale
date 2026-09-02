import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient } from '@autosale/database';
import { DynamicModule, Module } from '@nestjs/common';

import { CatalogueController } from './catalogue.controller.js';
import { CatalogueService } from './catalogue.service.js';

@Module({})
export class CatalogueModule {
  static register(env: ApiEnv): DynamicModule {
    return {
      module: CatalogueModule,
      controllers: [CatalogueController],
      providers: [{ provide: CatalogueService, useFactory: () => new CatalogueService(createPrismaClient(env.DATABASE_URL)) }],
    };
  }
}
