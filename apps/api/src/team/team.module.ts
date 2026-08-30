import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient } from '@autosale/database';
import { DynamicModule, Module } from '@nestjs/common';

import { CryptoService } from '../auth/crypto.service.js';
import { DevelopmentEmailDelivery, UnavailableEmailDelivery } from '../auth/email-delivery.js';
import { TeamController } from './team.controller.js';
import { TeamService } from './team.service.js';

@Module({})
export class TeamModule {
  static register(env: ApiEnv): DynamicModule {
    const email = env.NODE_ENV === 'production' ? new UnavailableEmailDelivery() : new DevelopmentEmailDelivery();
    return {
      module: TeamModule,
      controllers: [TeamController],
      providers: [{
        provide: TeamService,
        useFactory: () => new TeamService(createPrismaClient(env.DATABASE_URL), new CryptoService(), email, env.AUTH_TOKEN_PEPPER, env.APP_PUBLIC_URL),
      }],
    };
  }
}
