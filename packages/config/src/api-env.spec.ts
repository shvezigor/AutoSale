import { describe, expect, it } from 'vitest';

import { parseApiEnv } from './api-env.js';

const validEnv = {
  NODE_ENV: 'test',
  PORT: '3001',
  DATABASE_URL: 'postgresql://autosale:secret@postgres:5432/autosale',
  REDIS_URL: 'redis://redis:6379',
  DEFAULT_TENANT_ID: '11111111-1111-4111-8111-111111111111',
  DEFAULT_TENANT_KEY: 'default',
  META_VERIFY_TOKEN: 'verify-token-with-24-characters',
  META_APP_SECRET: 'meta-app-secret-value',
  META_APP_ID: '123456789012345',
  META_GRAPH_API_VERSION: 'v23.0',
  INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  S3_ENDPOINT: 'http://minio:9000',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'autosale-media',
  S3_ACCESS_KEY_ID: 'minio-access-key',
  S3_SECRET_ACCESS_KEY: 'minio-secret-key',
  SESSION_COOKIE_NAME: 'autosale_session',
  SESSION_PEPPER: 'session-pepper-with-at-least-32-characters',
  AUTH_TOKEN_PEPPER: 'auth-token-pepper-with-at-least-32-characters',
  APP_PUBLIC_URL: 'https://autosale.example.com',
};

describe('parseApiEnv', () => {
  it('coerces a valid API environment', () => {
    expect(parseApiEnv(validEnv)).toEqual({ ...validEnv, PORT: 3001, SMTP_PORT: 587 });
  });

  it('rejects an environment without the Meta app secret', () => {
    const { META_APP_SECRET: _omitted, ...incompleteEnv } = validEnv;

    expect(() => parseApiEnv(incompleteEnv)).toThrow();
  });

  it('treats an empty optional Google credential path as unconfigured', () => {
    expect(parseApiEnv({ ...validEnv, GOOGLE_SERVICE_ACCOUNT_FILE: '' }).GOOGLE_SERVICE_ACCOUNT_FILE).toBeUndefined();
  });

  it('rejects a short session pepper', () => {
    expect(() => parseApiEnv({ ...validEnv, SESSION_PEPPER: 'short' })).toThrow();
  });

  it('rejects an encryption key that does not decode to 32 bytes', () => {
    expect(() => parseApiEnv({ ...validEnv, INTEGRATION_ENCRYPTION_KEY: 'short' })).toThrow();
  });

  it('rejects a non-canonical encryption key', () => {
    expect(() => parseApiEnv({ ...validEnv, INTEGRATION_ENCRYPTION_KEY: `${validEnv.INTEGRATION_ENCRYPTION_KEY}=` })).toThrow();
  });

  it('rejects an invalid Meta Graph API version', () => {
    expect(() => parseApiEnv({ ...validEnv, META_GRAPH_API_VERSION: 'latest' })).toThrow();
  });
});
