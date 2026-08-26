import type { ApiEnv } from '@autosale/config/api-env';
import { DynamicModule, Module } from '@nestjs/common';

import { HealthController } from './health/health.controller.js';
import { ConversationsModule } from './conversations/conversations.module.js';
import { MetaModule } from './meta/meta.module.js';
import { MediaModule } from './media/media.module.js';

@Module({
  controllers: [HealthController],
})
export class AppModule {
  static register(env: ApiEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [ConversationsModule.register(env), MediaModule.register(env), MetaModule.register(env)],
    };
  }
}
