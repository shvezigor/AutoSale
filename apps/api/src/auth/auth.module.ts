import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient } from '@autosale/database';
import { DynamicModule, Module } from '@nestjs/common';

import { AuthController, AUTH_HTTP_CONFIG } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { CryptoService } from './crypto.service.js';
import { DevelopmentEmailDelivery, UnavailableEmailDelivery } from './email-delivery.js';
import { SessionService } from './session.service.js';

@Module({})
export class AuthModule {
  static register(env: ApiEnv): DynamicModule {
    const prisma = createPrismaClient(env.DATABASE_URL);
    const crypto = new CryptoService();
    const sessions = new SessionService(prisma, crypto, env.SESSION_PEPPER);
    const email = env.NODE_ENV === 'production' ? new UnavailableEmailDelivery() : new DevelopmentEmailDelivery();
    const auth = new AuthService(prisma, crypto, sessions, email, env.AUTH_TOKEN_PEPPER, env.APP_PUBLIC_URL);
    return {
      module: AuthModule,
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: SessionService, useValue: sessions },
        { provide: AUTH_HTTP_CONFIG, useValue: { cookieName: env.SESSION_COOKIE_NAME, production: env.NODE_ENV === 'production' } },
      ],
      exports: [SessionService, AUTH_HTTP_CONFIG],
    };
  }
}
