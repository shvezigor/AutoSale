import { Buffer } from 'node:buffer';

import type { ApiEnv } from '@autosale/config/api-env';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { InstagramOAuthController } from './instagram-oauth.controller.js';
import { InstagramOAuthModule, InstagramOAuthPrismaLifecycle } from './instagram-oauth.module.js';
import { InstagramOAuthService } from './instagram-oauth.service.js';

const env = {
  NODE_ENV: 'test',
  PORT: 3001,
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/autosale',
  REDIS_URL: 'redis://localhost:6379',
  DEFAULT_TENANT_ID: '11111111-1111-4111-8111-111111111111',
  DEFAULT_TENANT_KEY: 'default',
  META_VERIFY_TOKEN: 'verify-token-with-24-characters',
  META_APP_SECRET: 'meta-app-secret-value',
  META_APP_ID: '123456789012345',
  META_GRAPH_API_VERSION: 'v24.0',
  INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'autosale',
  S3_ACCESS_KEY_ID: 'access-key',
  S3_SECRET_ACCESS_KEY: 'secret-key',
  SESSION_COOKIE_NAME: 'autosale_session',
  SESSION_PEPPER: 's'.repeat(32),
  AUTH_TOKEN_PEPPER: 'a'.repeat(32),
  APP_PUBLIC_URL: 'https://demo.ngrok-free.app',
  GOOGLE_SIGN_IN_ENABLED: false,
  SMTP_PORT: 587,
} satisfies ApiEnv;

describe('InstagramOAuthModule', () => {
  it('disconnects its module-owned Prisma client during application shutdown', async () => {
    let disconnected = false;
    const lifecycle = new InstagramOAuthPrismaLifecycle({
      $disconnect: async () => { disconnected = true; },
    } as never);

    await lifecycle.onApplicationShutdown();

    expect(disconnected).toBe(true);
  });

  it('wires the OAuth service and controller from deployment configuration', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [InstagramOAuthModule.register(env)],
    }).compile();

    expect(moduleRef.get(InstagramOAuthService)).toBeInstanceOf(InstagramOAuthService);
    expect(moduleRef.get(InstagramOAuthController)).toBeInstanceOf(InstagramOAuthController);
    await moduleRef.close();
  });
});
