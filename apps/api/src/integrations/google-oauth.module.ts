import { Buffer } from 'node:buffer';

import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient, type PrismaClient } from '@autosale/database';
import { DynamicModule, Module, type OnApplicationShutdown } from '@nestjs/common';

import { CredentialCipher } from './credential-cipher.js';
import { GoogleOAuthClient, type GoogleOAuthClientPort } from './google-oauth.client.js';
import { GoogleOAuthController } from './google-oauth.controller.js';
import { GoogleOAuthService } from './google-oauth.service.js';
import { GoogleOAuthStateService } from './google-oauth-state.service.js';
import { GoogleCredentialCleanupService } from './google-credential-cleanup.service.js';
import { GoogleFilesClient } from './google-files.client.js';
import { GoogleFilesController } from './google-files.controller.js';
import { GoogleFilesService } from './google-files.service.js';
import { NotificationService } from '../notifications/notifications.service.js';

@Module({})
export class GoogleOAuthModule {
  static register(env: ApiEnv): DynamicModule {
    const prisma = createPrismaClient(env.DATABASE_URL);
    const client: GoogleOAuthClientPort = env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GOOGLE_OAUTH_REDIRECT_URI
      ? new GoogleOAuthClient(env.GOOGLE_OAUTH_CLIENT_ID, env.GOOGLE_OAUTH_CLIENT_SECRET, env.GOOGLE_OAUTH_REDIRECT_URI)
      : new UnconfiguredGoogleOAuthClient();
    const service = new GoogleOAuthService(
      prisma,
      client,
      new GoogleOAuthStateService(prisma),
      new CredentialCipher(Buffer.from(env.INTEGRATION_ENCRYPTION_KEY, 'base64')),
      undefined,
      new NotificationService(prisma as never),
    );
    const cleanup = new GoogleCredentialCleanupService(prisma, client, new CredentialCipher(Buffer.from(env.INTEGRATION_ENCRYPTION_KEY, 'base64')));
    const files = new GoogleFilesService(service, new GoogleFilesClient());
    return {
      module: GoogleOAuthModule,
      controllers: [GoogleOAuthController, GoogleFilesController],
      providers: [
        { provide: GoogleOAuthService, useValue: service },
        { provide: GoogleCredentialCleanupService, useValue: cleanup },
        { provide: GoogleFilesService, useValue: files },
        { provide: GoogleOAuthPrismaLifecycle, useValue: new GoogleOAuthPrismaLifecycle(prisma) },
      ],
      exports: [GoogleOAuthService, GoogleFilesService],
    };
  }
}

class UnconfiguredGoogleOAuthClient implements GoogleOAuthClientPort {
  getAuthorizationUrl(): string { throw new Error('Google OAuth is not configured'); }
  async exchangeCode(): Promise<never> { throw new Error('Google OAuth is not configured'); }
  async refreshAccessToken(): Promise<never> { throw new Error('Google OAuth is not configured'); }
  async revokeRefreshToken(): Promise<never> { throw new Error('Google OAuth is not configured'); }
}

class GoogleOAuthPrismaLifecycle implements OnApplicationShutdown {
  constructor(private readonly prisma: PrismaClient) {}
  async onApplicationShutdown(): Promise<void> { await this.prisma.$disconnect(); }
}
