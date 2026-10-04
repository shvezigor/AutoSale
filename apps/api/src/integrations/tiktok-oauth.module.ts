import { Buffer } from 'node:buffer';

import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient, type PrismaClient } from '@autosale/database';
import { TikTokBusinessMessagingClient } from '@autosale/integrations';
import { DynamicModule, Module, type OnApplicationShutdown } from '@nestjs/common';

import { CredentialCipher } from './credential-cipher.js';
import { TikTokOAuthController } from './tiktok-oauth.controller.js';
import {
  type TikTokAppWebhookHealth,
  TikTokOAuthService,
} from './tiktok-oauth.service.js';
import { TikTokOAuthStateService } from './tiktok-oauth-state.service.js';

@Module({})
export class TikTokOAuthModule {
  static register(env: ApiEnv): DynamicModule {
    const enabled = env.TIKTOK_BUSINESS_MESSAGING_ENABLED;
    if (enabled && (!env.TIKTOK_CLIENT_ID || !env.TIKTOK_CLIENT_SECRET || !env.TIKTOK_AUTHORIZATION_URL)) {
      throw new Error('TikTok Business Messaging requires provider credentials and authorization URL');
    }

    const prisma = createPrismaClient(env.DATABASE_URL);
    const lifecycle = new TikTokOAuthPrismaLifecycle(prisma);
    const service = new TikTokOAuthService(
      prisma,
      new TikTokBusinessMessagingClient({
        clientId: env.TIKTOK_CLIENT_ID ?? 'tiktok-disabled',
        clientSecret: env.TIKTOK_CLIENT_SECRET ?? 'tiktok-disabled',
        authorizationUrl: env.TIKTOK_AUTHORIZATION_URL ?? 'https://business-api.tiktok.com/portal/auth?disabled=true',
      }),
      new TikTokOAuthStateService(prisma),
      new CredentialCipher(Buffer.from(env.INTEGRATION_ENCRYPTION_KEY, 'base64')),
      new PendingTikTokAppWebhookHealth(),
      env.APP_PUBLIC_URL,
      enabled,
    );

    return {
      module: TikTokOAuthModule,
      controllers: [TikTokOAuthController],
      providers: [
        { provide: TikTokOAuthService, useValue: service },
        { provide: TikTokOAuthPrismaLifecycle, useValue: lifecycle },
      ],
      exports: [TikTokOAuthService],
    };
  }
}

class PendingTikTokAppWebhookHealth implements TikTokAppWebhookHealth {
  async assertHealthy(): Promise<void> {
    throw new Error('TikTok app webhook is not reconciled');
  }
}

export class TikTokOAuthPrismaLifecycle implements OnApplicationShutdown {
  constructor(private readonly prisma: PrismaClient) {}

  async onApplicationShutdown(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
