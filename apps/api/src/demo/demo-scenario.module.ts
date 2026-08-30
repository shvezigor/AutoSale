import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient } from '@autosale/database';
import { DynamicModule, Module } from '@nestjs/common';

import { INSTAGRAM_NORMALIZE_QUEUE, QueueModule } from '../queue/queue.module.js';
import { DemoScenarioController } from './demo-scenario.controller.js';
import { DemoScenarioService } from './demo-scenario.service.js';

@Module({})
export class DemoScenarioModule {
  static register(env: ApiEnv): DynamicModule {
    return {
      module: DemoScenarioModule,
      imports: [QueueModule.register(env.REDIS_URL)],
      controllers: [DemoScenarioController],
      providers: [{
        provide: DemoScenarioService,
        inject: [INSTAGRAM_NORMALIZE_QUEUE],
        useFactory: (queue: ConstructorParameters<typeof DemoScenarioService>[1]) => new DemoScenarioService(createPrismaClient(env.DATABASE_URL), queue),
      }],
    };
  }
}
