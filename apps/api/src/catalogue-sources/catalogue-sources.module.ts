import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';

import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient } from '@autosale/database';
import { CredentialCipher, createGoogleSheetsAdapter, GoogleOAuthTokenProvider, GoogleSheetsAdapter } from '@autosale/integrations';
import { DynamicModule, Module } from '@nestjs/common';
import { Queue } from 'bullmq';

import { CatalogueSourcesController } from './catalogue-sources.controller.js';
import { CatalogueSourcesService } from './catalogue-sources.service.js';
import { GoogleFilesClient } from '../integrations/google-files.client.js';

@Module({})
export class CatalogueSourcesModule {
  static register(env: ApiEnv): DynamicModule {
    return {
      module: CatalogueSourcesModule,
      controllers: [CatalogueSourcesController],
      providers: [{
        provide: CatalogueSourcesService,
        useFactory: () => {
          const prisma = createPrismaClient(env.DATABASE_URL);
          const oauthTokens = env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET
            ? new GoogleOAuthTokenProvider({
              findConnection: async (connectionId, tenantId) => prisma.googleConnection.findFirst({
                where: { id: connectionId, tenantId },
                select: { id: true, tenantId: true, status: true, encryptedRefreshToken: true, credentialGenerationId: true },
              }),
              markReauthorizationRequired: async (tenantId, credentialGenerationId) => {
                await prisma.googleConnection.updateMany({
                  where: { tenantId, credentialGenerationId },
                  data: { status: 'REAUTHORIZATION_REQUIRED', lastErrorCode: 'GOOGLE_TOKEN_REFRESH_FAILED' },
                });
              },
            }, new CredentialCipher(Buffer.from(env.INTEGRATION_ENCRYPTION_KEY, 'base64')), {
              clientId: env.GOOGLE_OAUTH_CLIENT_ID,
              clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
            })
            : undefined;
          const files = new GoogleFilesClient();
          const oauth = oauthTokens ? {
            verifySpreadsheet: async (tenantId: string, connectionId: string, spreadsheetId: string) =>
              files.inspectSpreadsheet(await oauthTokens.getAccessToken(connectionId, tenantId), spreadsheetId),
            sheetsForConnection: async (tenantId: string, connectionId: string) => new GoogleSheetsAdapter({
              getAccessToken: () => oauthTokens.getAccessToken(connectionId, tenantId),
            }),
          } : undefined;
          return new CatalogueSourcesService(
            prisma,
            env.GOOGLE_SERVICE_ACCOUNT_FILE ? createGoogleSheetsAdapter(env.GOOGLE_SERVICE_ACCOUNT_FILE) : undefined,
            new Queue('catalogue', { connection: queueConnection(env.REDIS_URL) }),
            { ...serviceAccountConfig(env.GOOGLE_SERVICE_ACCOUNT_FILE), oauthRequired: oauth !== undefined },
            oauth,
          );
        },
      }],
    };
  }
}

function readServiceAccountEmail(path: string | undefined): string | undefined {
  if (!path) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { client_email?: unknown };
    return typeof parsed.client_email === 'string' && /^[^\s@]+@[^\s@]+$/.test(parsed.client_email) ? parsed.client_email : undefined;
  } catch {
    return undefined;
  }
}

function serviceAccountConfig(path: string | undefined): { serviceAccountEmail?: string } {
  const serviceAccountEmail = readServiceAccountEmail(path);
  return serviceAccountEmail ? { serviceAccountEmail } : {};
}

function queueConnection(redisUrl: string) {
  const url = new URL(redisUrl);
  return { host: url.hostname, port: Number(url.port || 6379), username: url.username || undefined, password: url.password || undefined, tls: url.protocol === 'rediss:' ? {} : undefined };
}
