import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient, type PrismaClient } from '@autosale/database';
import { DynamicModule, Module, type OnApplicationShutdown } from '@nestjs/common';

import { TelegramService } from './telegram.service.js';
import { TelegramController } from './telegram.controller.js';
import { TELEGRAM_WEBHOOK_SECRET, TelegramWebhookController } from './telegram-webhook.controller.js';

@Module({})
export class TelegramModule {
  static register(env: ApiEnv): DynamicModule {
    const prisma = createPrismaClient(env.DATABASE_URL);
    return {
      module: TelegramModule,
      controllers: [TelegramWebhookController, TelegramController],
      providers: [
        { provide: TelegramService, useValue: new TelegramService(prisma, undefined, env.TELEGRAM_BOT_USERNAME ? { botUsername: env.TELEGRAM_BOT_USERNAME } : {}) },
        { provide: TELEGRAM_WEBHOOK_SECRET, useValue: env.TELEGRAM_WEBHOOK_SECRET },
        { provide: TelegramPrismaLifecycle, useValue: new TelegramPrismaLifecycle(prisma) },
      ],
      exports: [TelegramService],
    };
  }
}

class TelegramPrismaLifecycle implements OnApplicationShutdown {
  constructor(private readonly prisma: PrismaClient) {}
  async onApplicationShutdown(): Promise<void> { await this.prisma.$disconnect(); }
}
