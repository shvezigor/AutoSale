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
  S3_ENDPOINT: 'http://minio:9000',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'autosale-media',
  S3_ACCESS_KEY_ID: 'minio-access-key',
  S3_SECRET_ACCESS_KEY: 'minio-secret-key',
};

describe('parseApiEnv', () => {
  it('coerces a valid API environment', () => {
    expect(parseApiEnv(validEnv)).toEqual({ ...validEnv, PORT: 3001 });
  });

  it('rejects an environment without the Meta app secret', () => {
    const { META_APP_SECRET: _omitted, ...incompleteEnv } = validEnv;

    expect(() => parseApiEnv(incompleteEnv)).toThrow();
  });

  it('treats an empty optional Google credential path as unconfigured', () => {
    expect(parseApiEnv({ ...validEnv, GOOGLE_SERVICE_ACCOUNT_FILE: '' }).GOOGLE_SERVICE_ACCOUNT_FILE).toBeUndefined();
  });
});
