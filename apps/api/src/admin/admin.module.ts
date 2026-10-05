import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient } from '@autosale/database';
import { S3ObjectStorage } from '@autosale/integrations';
import { DynamicModule, Module } from '@nestjs/common';
import { Queue } from 'bullmq';

import { CryptoService } from '../auth/crypto.service.js';
import { platformChannelDeployment } from '../integrations/platform-channel-deployment.js';
import { AdminController } from './admin.controller.js';
import { AdminIntegrationService } from './admin-integration.service.js';
import { BullAdminQueueMonitor } from './admin-queue-monitor.js';
import { AdminService } from './admin.service.js';
import { AdminStepUpService } from './admin-step-up.service.js';
import { TenantLifecycleService } from './tenant-lifecycle.service.js';

@Module({})
export class AdminModule {
  static register(env: ApiEnv): DynamicModule {
    const prisma = createPrismaClient(env.DATABASE_URL);
    const connection = queueConnection(env.REDIS_URL);
    const queue = new Queue('tenant-lifecycle', { connection });
    const monitoredQueues = (['instagram', 'catalogue', 'delivery', 'telegram', 'ai-replies'] as const)
      .map((name) => new BullAdminQueueMonitor(name, new Queue(name, { connection })));
    monitoredQueues.push(new BullAdminQueueMonitor('tenant-lifecycle', queue));
    const stepUp = new AdminStepUpService(prisma, new CryptoService(), env.AUTH_TOKEN_PEPPER);
    const integrationDeployment = platformChannelDeployment(env);
    const storage = new S3ObjectStorage({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: true,
    });
    return {
      module: AdminModule,
      controllers: [AdminController],
      providers: [
        { provide: AdminService, useValue: new AdminService(prisma, undefined, monitoredQueues) },
        { provide: AdminIntegrationService, useValue: new AdminIntegrationService(prisma, integrationDeployment) },
        { provide: AdminStepUpService, useValue: stepUp },
        { provide: TenantLifecycleService, useValue: new TenantLifecycleService(
          prisma, queue, stepUp, undefined, undefined, storage,
        ) },
      ],
    };
  }
}

function queueConnection(redisUrl: string) {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    tls: url.protocol === 'rediss:' ? {} : undefined,
  };
}
