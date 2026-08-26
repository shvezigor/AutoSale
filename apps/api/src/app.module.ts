import type { ApiEnv } from '@autosale/config/api-env';
import { DynamicModule, Module } from '@nestjs/common';

import { HealthController } from './health/health.controller.js';
import { MetaModule } from './meta/meta.module.js';

@Module({
  controllers: [HealthController],
})
export class AppModule {
  static register(env: ApiEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [MetaModule.register(env)],
    };
  }
}
