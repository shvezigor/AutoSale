import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient, type PrismaClient } from '@autosale/database';
import { DynamicModule, Module, type OnApplicationShutdown } from '@nestjs/common';

import { QueueModule } from '../queue/queue.module.js';
import { TikTokEventService } from './tiktok-event.service.js';
import { TikTokSignatureService } from './tiktok-signature.service.js';
import { TIKTOK_WEBHOOK_CONFIG, TikTokWebhookController } from './tiktok-webhook.controller.js';

@Module({})
export class TikTokModule {
  static register(env: ApiEnv): DynamicModule {
    const prisma = createPrismaClient(env.DATABASE_URL);
    const lifecycle = new TikTokWebhookPrismaLifecycle(prisma);
    return {
      module: TikTokModule,
      imports: [QueueModule.register(env.REDIS_URL)],
      controllers: [TikTokWebhookController],
      providers: [
        {
          provide: TIKTOK_WEBHOOK_CONFIG,
          useValue: {
            appId: env.TIKTOK_CLIENT_ID ?? 'tiktok-disabled',
            enabled: env.TIKTOK_BUSINESS_MESSAGING_ENABLED,
          },
        },
        {
          provide: TikTokSignatureService,
          useValue: new TikTokSignatureService(env.TIKTOK_CLIENT_SECRET ?? 'tiktok-disabled'),
        },
        { provide: TikTokEventService, useValue: new TikTokEventService(prisma) },
        { provide: TikTokWebhookPrismaLifecycle, useValue: lifecycle },
      ],
    };
  }
}

export class TikTokWebhookPrismaLifecycle implements OnApplicationShutdown {
  constructor(private readonly prisma: PrismaClient) {}

  async onApplicationShutdown(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
