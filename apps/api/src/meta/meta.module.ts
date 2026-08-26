import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient } from '@autosale/database';
import { DynamicModule, Module } from '@nestjs/common';

import { QueueModule } from '../queue/queue.module.js';
import { MetaEventService } from './meta-event.service.js';
import { META_WEBHOOK_CONFIG, MetaController } from './meta.controller.js';
import { MetaSignatureService } from './meta-signature.service.js';

@Module({})
export class MetaModule {
  static register(env: ApiEnv): DynamicModule {
    return {
      module: MetaModule,
      imports: [QueueModule.register(env.REDIS_URL)],
      controllers: [MetaController],
      providers: [
        {
          provide: META_WEBHOOK_CONFIG,
          useValue: { tenantId: env.DEFAULT_TENANT_ID, verifyToken: env.META_VERIFY_TOKEN },
        },
        {
          provide: MetaSignatureService,
          useValue: new MetaSignatureService(env.META_APP_SECRET),
        },
        {
          provide: MetaEventService,
          useFactory: async () => {
            const prisma = createPrismaClient(env.DATABASE_URL);
            await prisma.tenant.upsert({
              where: { id: env.DEFAULT_TENANT_ID },
              update: { key: env.DEFAULT_TENANT_KEY },
              create: {
                id: env.DEFAULT_TENANT_ID,
                key: env.DEFAULT_TENANT_KEY,
                name: env.DEFAULT_TENANT_KEY,
              },
            });
            return new MetaEventService(prisma);
          },
        },
      ],
    };
  }
}
