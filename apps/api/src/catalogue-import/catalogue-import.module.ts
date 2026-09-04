import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient } from '@autosale/database';
import { S3ObjectStorage } from '@autosale/integrations';
import { DynamicModule, Module } from '@nestjs/common';
import { Queue } from 'bullmq';

import { CatalogueImportController } from './catalogue-import.controller.js';
import { CatalogueImportService } from './catalogue-import.service.js';
import { NotificationService } from '../notifications/notifications.service.js';

@Module({})
export class CatalogueImportModule {
  static register(env: ApiEnv): DynamicModule {
    return {
      module: CatalogueImportModule,
      controllers: [CatalogueImportController],
      providers: [{
        provide: CatalogueImportService,
        inject: [NotificationService],
        useFactory: (notifications: NotificationService) => new CatalogueImportService(
          createPrismaClient(env.DATABASE_URL),
          new S3ObjectStorage({
            endpoint: env.S3_ENDPOINT,
            region: env.S3_REGION,
            bucket: env.S3_BUCKET,
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            forcePathStyle: true,
          }),
          new Queue('catalogue', { connection: queueConnection(env.REDIS_URL) }),
          notifications,
        ),
      }],
    };
  }
}

function queueConnection(redisUrl: string) {
  const url = new URL(redisUrl);
  return { host: url.hostname, port: Number(url.port || 6379), username: url.username || undefined, password: url.password || undefined, tls: url.protocol === 'rediss:' ? {} : undefined };
}
