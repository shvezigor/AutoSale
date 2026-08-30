import type { ApiEnv } from '@autosale/config/api-env';
import { DynamicModule, Module } from '@nestjs/common';

import { HealthController } from './health/health.controller.js';
import { ConversationsModule } from './conversations/conversations.module.js';
import { MetaModule } from './meta/meta.module.js';
import { MediaModule } from './media/media.module.js';
import { OrderSettingsModule } from './settings/order-settings.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { AuthModule } from './auth/auth.module.js';
import { TeamModule } from './team/team.module.js';
import { AdminModule } from './admin/admin.module.js';
import { InstagramOAuthModule } from './integrations/instagram-oauth.module.js';

@Module({
  controllers: [HealthController],
})
export class AppModule {
  static register(env: ApiEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AuthModule.register(env),
        TeamModule.register(env),
        AdminModule.register(env),
        ConversationsModule.register(env),
        MediaModule.register(env),
        MetaModule.register(env),
        OrderSettingsModule.register(env),
        OrdersModule.register(env),
        InstagramOAuthModule.register(env),
      ],
    };
  }
}
