import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient, PlatformChannelGate } from '@autosale/database';
import { DynamicModule, Module } from '@nestjs/common';

import { ConversationsController } from './conversations.controller.js';
import { ConversationsService, type InstagramMessageQueue } from './conversations.service.js';
import { INSTAGRAM_QUEUE, QueueModule } from '../queue/queue.module.js';
import { platformChannelDeployment } from '../integrations/platform-channel-deployment.js';

@Module({})
export class ConversationsModule {
  static register(env: ApiEnv): DynamicModule {
    return {
      module: ConversationsModule,
      imports: [QueueModule.register(env.REDIS_URL)],
      controllers: [ConversationsController],
      providers: [
        {
          provide: ConversationsService,
          inject: [INSTAGRAM_QUEUE],
          useFactory: (queue: InstagramMessageQueue) => {
            const prisma = createPrismaClient(env.DATABASE_URL);
            return new ConversationsService(
              prisma,
              queue,
              new PlatformChannelGate(prisma, platformChannelDeployment(env)),
            );
          },
        },
      ],
    };
  }
}
