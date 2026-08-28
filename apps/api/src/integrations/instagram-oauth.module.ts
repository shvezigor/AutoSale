import { Buffer } from 'node:buffer';

import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient } from '@autosale/database';
import { MetaInstagramClient } from '@autosale/integrations';
import { DynamicModule, Module } from '@nestjs/common';

import { CredentialCipher } from './credential-cipher.js';
import { InstagramOAuthController } from './instagram-oauth.controller.js';
import { InstagramOAuthService } from './instagram-oauth.service.js';
import { InstagramOAuthStateService } from './instagram-oauth-state.service.js';

@Module({})
export class InstagramOAuthModule {
  static register(env: ApiEnv): DynamicModule {
    const prisma = createPrismaClient(env.DATABASE_URL);
    const meta = new MetaInstagramClient({
      appId: env.META_APP_ID,
      appSecret: env.META_APP_SECRET,
      graphVersion: env.META_GRAPH_API_VERSION,
    });
    const service = new InstagramOAuthService(
      prisma,
      meta,
      new InstagramOAuthStateService(prisma),
      new CredentialCipher(Buffer.from(env.INTEGRATION_ENCRYPTION_KEY, 'base64')),
      env.APP_PUBLIC_URL,
    );

    return {
      module: InstagramOAuthModule,
      controllers: [InstagramOAuthController],
      providers: [{ provide: InstagramOAuthService, useValue: service }],
      exports: [InstagramOAuthService],
    };
  }
}
