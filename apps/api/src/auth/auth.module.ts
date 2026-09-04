import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient } from '@autosale/database';
import { GoogleSignInClient } from '@autosale/integrations';
import { DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import Redis from 'ioredis';

import { AuthController, AUTH_HTTP_CONFIG } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { CryptoService } from './crypto.service.js';
import { CsrfService } from './csrf.service.js';
import { createEmailDelivery } from './email-delivery.js';
import { GoogleSignInController, GOOGLE_SIGN_IN_HTTP_CONFIG } from './google-sign-in.controller.js';
import { GoogleSignInService } from './google-sign-in.service.js';
import { GoogleSignInStateService } from './google-sign-in-state.service.js';
import { RateLimitService, RedisRateLimitStore } from './rate-limit.service.js';
import { SessionService } from './session.service.js';

@Module({})
export class AuthModule {
  static register(env: ApiEnv): DynamicModule {
    const prisma = createPrismaClient(env.DATABASE_URL);
    const crypto = new CryptoService();
    const sessions = new SessionService(prisma, crypto, env.SESSION_PEPPER);
    const csrf = new CsrfService(env.SESSION_PEPPER);
    const redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
    const rateLimit = new RateLimitService(new RedisRateLimitStore(redis), env.AUTH_TOKEN_PEPPER);
    const email = createEmailDelivery(env);
    const auth = new AuthService(prisma, crypto, sessions, email, env.AUTH_TOKEN_PEPPER, env.APP_PUBLIC_URL);
    const googleSignInState = new GoogleSignInStateService(prisma);
    const googleSignInClient = new GoogleSignInClient({
      clientId: env.GOOGLE_OAUTH_CLIENT_ID ?? '',
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
      redirectUri: env.GOOGLE_SIGN_IN_REDIRECT_URI ?? `${env.APP_PUBLIC_URL}/api/auth/google/callback`,
    });
    const googleSignIn = new GoogleSignInService(
      prisma, googleSignInClient, googleSignInState, sessions, env.GOOGLE_SIGN_IN_ENABLED,
    );
    return {
      module: AuthModule,
      controllers: [AuthController, GoogleSignInController],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: GoogleSignInService, useValue: googleSignIn },
        { provide: SessionService, useValue: sessions },
        { provide: CsrfService, useValue: csrf },
        { provide: RateLimitService, useValue: rateLimit },
        AuthGuard,
        { provide: APP_GUARD, useExisting: AuthGuard },
        { provide: AUTH_HTTP_CONFIG, useValue: { cookieName: env.SESSION_COOKIE_NAME, production: env.NODE_ENV === 'production' } },
        { provide: GOOGLE_SIGN_IN_HTTP_CONFIG, useValue: {
          cookieName: env.SESSION_COOKIE_NAME, onboardingCookieName: 'autosale_google_onboarding',
          production: env.NODE_ENV === 'production',
        } },
      ],
      exports: [SessionService, CsrfService, AuthGuard, AUTH_HTTP_CONFIG],
    };
  }
}
