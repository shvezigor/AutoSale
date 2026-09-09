import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient, type PrismaClient } from '@autosale/database';
import { DynamicModule, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';

import { TelegramService } from './telegram.service.js';
import { TelegramController } from './telegram.controller.js';
import { TELEGRAM_WEBHOOK_SECRET, TelegramWebhookController } from './telegram-webhook.controller.js';

@Module({})
export class TelegramModule {
  static register(env: ApiEnv): DynamicModule {
    const prisma = createPrismaClient(env.DATABASE_URL);
    const queue = env.TELEGRAM_BOT_TOKEN
      ? new Queue('telegram', { connection: queueConnection(env.REDIS_URL) })
      : undefined;
    return {
      module: TelegramModule,
      controllers: [TelegramWebhookController, TelegramController],
      providers: [
        {
          provide: TelegramService,
          useValue: new TelegramService(prisma, undefined, env.TELEGRAM_BOT_USERNAME && queue
            ? { botUsername: env.TELEGRAM_BOT_USERNAME, queue }
            : {}),
        },
        { provide: TELEGRAM_WEBHOOK_SECRET, useValue: env.TELEGRAM_WEBHOOK_SECRET },
        { provide: TelegramPrismaLifecycle, useValue: new TelegramPrismaLifecycle(prisma, queue) },
      ],
      exports: [TelegramService],
    };
  }
}

class TelegramPrismaLifecycle implements OnApplicationShutdown {
  constructor(private readonly prisma: PrismaClient, private readonly queue?: Queue) {}
  async onApplicationShutdown(): Promise<void> {
    await this.queue?.close();
    await this.prisma.$disconnect();
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
