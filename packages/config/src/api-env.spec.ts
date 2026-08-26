import { describe, expect, it } from 'vitest';

import { parseApiEnv } from './api-env.js';

const validEnv = {
  NODE_ENV: 'test',
  PORT: '3001',
  DATABASE_URL: 'postgresql://autosale:secret@postgres:5432/autosale',
  REDIS_URL: 'redis://redis:6379',
  META_VERIFY_TOKEN: 'verify-token-with-24-characters',
  META_APP_SECRET: 'meta-app-secret-value',
};

describe('parseApiEnv', () => {
  it('coerces a valid API environment', () => {
    expect(parseApiEnv(validEnv)).toEqual({ ...validEnv, PORT: 3001 });
  });

  it('rejects an environment without the Meta app secret', () => {
    const { META_APP_SECRET: _omitted, ...incompleteEnv } = validEnv;

    expect(() => parseApiEnv(incompleteEnv)).toThrow();
  });
});
