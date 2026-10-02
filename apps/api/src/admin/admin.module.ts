import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient } from '@autosale/database';
import { DynamicModule, Module } from '@nestjs/common';
import { Queue } from 'bullmq';

import { CryptoService } from '../auth/crypto.service.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { AdminStepUpService } from './admin-step-up.service.js';
import { TenantLifecycleService } from './tenant-lifecycle.service.js';

@Module({})
export class AdminModule {
  static register(env: ApiEnv): DynamicModule {
    const prisma = createPrismaClient(env.DATABASE_URL);
    const queue = new Queue('tenant-lifecycle', { connection: queueConnection(env.REDIS_URL) });
    const stepUp = new AdminStepUpService(prisma, new CryptoService(), env.AUTH_TOKEN_PEPPER);
    return {
      module: AdminModule,
      controllers: [AdminController],
      providers: [
        { provide: AdminService, useValue: new AdminService(prisma) },
        { provide: AdminStepUpService, useValue: stepUp },
        { provide: TenantLifecycleService, useValue: new TenantLifecycleService(prisma, queue, stepUp) },
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
