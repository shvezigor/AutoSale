import { Buffer } from 'node:buffer';

import { parseApiEnv } from '@autosale/config/api-env';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { TikTokOAuthController } from './tiktok-oauth.controller.js';
import { TikTokOAuthModule, TikTokOAuthPrismaLifecycle } from './tiktok-oauth.module.js';
import { TikTokOAuthService } from './tiktok-oauth.service.js';

const env = parseApiEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/autosale',
  REDIS_URL: 'redis://localhost:6379',
  DEFAULT_TENANT_ID: '11111111-1111-4111-8111-111111111111',
  DEFAULT_TENANT_KEY: 'default',
  META_VERIFY_TOKEN: 'verify-token-with-24-characters',
  META_APP_SECRET: 'meta-app-secret-value',
  META_APP_ID: '123456789012345',
  META_GRAPH_API_VERSION: 'v24.0',
  TIKTOK_BUSINESS_MESSAGING_ENABLED: 'true',
  TIKTOK_CLIENT_ID: 'fictional-tiktok-client',
  TIKTOK_CLIENT_SECRET: 'fictional-tiktok-secret',
  TIKTOK_AUTHORIZATION_URL: 'https://business-api.tiktok.com/portal/auth?app_id=fictional',
  INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'autosale',
  S3_ACCESS_KEY_ID: 'access-key',
  S3_SECRET_ACCESS_KEY: 'secret-key',
  SESSION_PEPPER: 's'.repeat(32),
  AUTH_TOKEN_PEPPER: 'a'.repeat(32),
  APP_PUBLIC_URL: 'https://sales-aito.example',
});

describe('TikTokOAuthModule', () => {
  it('disconnects its module-owned Prisma client during shutdown', async () => {
    let disconnected = false;
    const lifecycle = new TikTokOAuthPrismaLifecycle({ $disconnect: async () => { disconnected = true; } } as never);
    await lifecycle.onApplicationShutdown();
    expect(disconnected).toBe(true);
  });

  it('wires the TikTok service and controller from deployment configuration', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TikTokOAuthModule.register(env)] }).compile();
    expect(moduleRef.get(TikTokOAuthService)).toBeInstanceOf(TikTokOAuthService);
    expect(moduleRef.get(TikTokOAuthController)).toBeInstanceOf(TikTokOAuthController);
    await moduleRef.close();
  });
});
