import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient } from '@autosale/database';
import { DynamicModule, Module } from '@nestjs/common';

import { ConversationsController } from './conversations.controller.js';
import { ConversationsService } from './conversations.service.js';

@Module({})
export class ConversationsModule {
  static register(env: ApiEnv): DynamicModule {
    return {
      module: ConversationsModule,
      controllers: [ConversationsController],
      providers: [
        {
          provide: ConversationsService,
          useFactory: () =>
            new ConversationsService(createPrismaClient(env.DATABASE_URL), env.DEFAULT_TENANT_ID),
        },
      ],
    };
  }
}
