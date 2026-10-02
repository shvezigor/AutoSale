import { Buffer } from 'node:buffer';

import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient, type PrismaClient } from '@autosale/database';
import { MetaFacebookClient } from '@autosale/integrations';
import { DynamicModule, Module, type OnApplicationShutdown } from '@nestjs/common';

import { CredentialCipher } from './credential-cipher.js';
import { FacebookOAuthController } from './facebook-oauth.controller.js';
import { FacebookOAuthService } from './facebook-oauth.service.js';
import { FacebookOAuthStateService } from './facebook-oauth-state.service.js';

@Module({})
export class FacebookOAuthModule {
  static register(env: ApiEnv): DynamicModule {
    const prisma = createPrismaClient(env.DATABASE_URL);
    const lifecycle = new FacebookOAuthPrismaLifecycle(prisma);
    const service = new FacebookOAuthService(
      prisma,
      new MetaFacebookClient({
        appId: env.META_APP_ID,
        appSecret: env.META_APP_SECRET,
        graphVersion: env.META_GRAPH_API_VERSION,
      }),
      new FacebookOAuthStateService(prisma),
      new CredentialCipher(Buffer.from(env.INTEGRATION_ENCRYPTION_KEY, 'base64')),
      env.APP_PUBLIC_URL,
      env.FACEBOOK_MESSENGER_ENABLED,
    );

    return {
      module: FacebookOAuthModule,
      controllers: [FacebookOAuthController],
      providers: [
        { provide: FacebookOAuthService, useValue: service },
        { provide: FacebookOAuthPrismaLifecycle, useValue: lifecycle },
      ],
      exports: [FacebookOAuthService],
    };
  }
}

export class FacebookOAuthPrismaLifecycle implements OnApplicationShutdown {
  constructor(private readonly prisma: PrismaClient) {}

  async onApplicationShutdown(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
