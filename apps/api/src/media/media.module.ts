import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient } from '@autosale/database';
import { S3ObjectStorage } from '@autosale/integrations';
import { DynamicModule, Module } from '@nestjs/common';

import { MediaController } from './media.controller.js';
import { MediaService } from './media.service.js';

@Module({})
export class MediaModule {
  static register(env: ApiEnv): DynamicModule {
    return {
      module: MediaModule,
      controllers: [MediaController],
      providers: [
        {
          provide: MediaService,
          useFactory: () =>
            new MediaService(
              createPrismaClient(env.DATABASE_URL),
              new S3ObjectStorage({
                endpoint: env.S3_ENDPOINT,
                region: env.S3_REGION,
                bucket: env.S3_BUCKET,
                accessKeyId: env.S3_ACCESS_KEY_ID,
                secretAccessKey: env.S3_SECRET_ACCESS_KEY,
                forcePathStyle: true,
              }),
              env.DEFAULT_TENANT_ID,
            ),
        },
      ],
    };
  }
}
