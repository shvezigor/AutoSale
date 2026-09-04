import { Buffer } from 'node:buffer';

import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient } from '@autosale/database';
import { CredentialCipher, createGoogleSheetsAdapter, GoogleOAuthTokenProvider, GoogleSheetsAdapter } from '@autosale/integrations';
import { DynamicModule, Module } from '@nestjs/common';

import { OrderSettingsController } from './order-settings.controller.js';
import { OrderSettingsService } from './order-settings.service.js';
import { GoogleSheetsSettingsController } from './google-sheets-settings.controller.js';
import { GoogleSheetsSettingsService } from './google-sheets-settings.service.js';
import { GoogleFilesClient } from '../integrations/google-files.client.js';
import { NotificationService } from '../notifications/notifications.service.js';

@Module({})
export class OrderSettingsModule {
  static register(env: ApiEnv): DynamicModule {
    return {
      module: OrderSettingsModule,
      controllers: [OrderSettingsController, GoogleSheetsSettingsController],
      providers: [
        {
          provide: OrderSettingsService,
          useFactory: () =>
            new OrderSettingsService(createPrismaClient(env.DATABASE_URL)),
        },
        {
          provide: GoogleSheetsSettingsService,
          inject: [NotificationService],
          useFactory: (notifications: NotificationService) => {
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
            return new GoogleSheetsSettingsService(
              prisma,
              env.GOOGLE_SERVICE_ACCOUNT_FILE ? createGoogleSheetsAdapter(env.GOOGLE_SERVICE_ACCOUNT_FILE) : undefined,
              { oauthRequired: oauth !== undefined },
              oauth,
              notifications,
            );
          },
        },
      ],
    };
  }
}
