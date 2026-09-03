import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import { parseWorkerEnv } from './worker-env.js';

const validEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://autosale:secret@postgres:5432/autosale',
  REDIS_URL: 'redis://redis:6379',
  S3_ENDPOINT: 'http://minio:9000',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'autosale-media',
  S3_ACCESS_KEY_ID: 'minio-access-key',
  S3_SECRET_ACCESS_KEY: 'minio-secret-key',
  OPENAI_API_KEY: 'sk-test-not-a-real-key-value',
  OPENAI_MODEL: 'gpt-5.4-mini',
  INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  GOOGLE_OAUTH_CLIENT_ID: 'google-client-id',
  GOOGLE_OAUTH_CLIENT_SECRET: 'google-client-secret',
};

describe('parseWorkerEnv', () => {
  it('accepts a complete worker environment', () => {
    expect(parseWorkerEnv(validEnv)).toEqual({ ...validEnv, HEALTH_PORT: 3002 });
  });

  it('rejects a missing object-storage bucket', () => {
    const { S3_BUCKET: _omitted, ...incompleteEnv } = validEnv;

    expect(() => parseWorkerEnv(incompleteEnv)).toThrow();
  });

  it('rejects a missing OpenAI API key', () => {
    const { OPENAI_API_KEY: _omitted, ...incompleteEnv } = validEnv;

    expect(() => parseWorkerEnv(incompleteEnv)).toThrow();
  });

  it('rejects partial Google OAuth worker credentials', () => {
    const { GOOGLE_OAUTH_CLIENT_SECRET: _omitted, ...incompleteEnv } = validEnv;
    expect(() => parseWorkerEnv(incompleteEnv)).toThrow();
  });
});
