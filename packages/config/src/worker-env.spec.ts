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
};

describe('parseWorkerEnv', () => {
  it('accepts a complete worker environment', () => {
    expect(parseWorkerEnv(validEnv)).toEqual({ ...validEnv, HEALTH_PORT: 3002 });
  });

  it('rejects a missing object-storage bucket', () => {
    const { S3_BUCKET: _omitted, ...incompleteEnv } = validEnv;

    expect(() => parseWorkerEnv(incompleteEnv)).toThrow();
  });
});
