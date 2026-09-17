import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient } from '@autosale/database';
import { DynamicModule, Module } from '@nestjs/common';

import { createDemoLeadNotifier } from './demo-lead-notifier.js';
import { DemoLeadsController } from './demo-leads.controller.js';
import { DemoLeadsService } from './demo-leads.service.js';

@Module({})
export class DemoLeadsModule {
  static register(env: ApiEnv): DynamicModule {
    return { module: DemoLeadsModule, controllers: [DemoLeadsController], providers: [{ provide: DemoLeadsService, useFactory: () => new DemoLeadsService(createPrismaClient(env.DATABASE_URL), createDemoLeadNotifier(env)) }] };
  }
}
