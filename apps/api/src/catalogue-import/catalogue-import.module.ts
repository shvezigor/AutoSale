import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient } from '@autosale/database';
import { S3ObjectStorage } from '@autosale/integrations';
import { DynamicModule, Module } from '@nestjs/common';

import { CatalogueImportController } from './catalogue-import.controller.js';
import { CatalogueImportService } from './catalogue-import.service.js';

@Module({})
export class CatalogueImportModule {
  static register(env: ApiEnv): DynamicModule {
    return {
      module: CatalogueImportModule,
      controllers: [CatalogueImportController],
      providers: [{
        provide: CatalogueImportService,
        useFactory: () => new CatalogueImportService(
          createPrismaClient(env.DATABASE_URL),
          new S3ObjectStorage({
            endpoint: env.S3_ENDPOINT,
            region: env.S3_REGION,
            bucket: env.S3_BUCKET,
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            forcePathStyle: true,
          }),
        ),
      }],
    };
  }
}
