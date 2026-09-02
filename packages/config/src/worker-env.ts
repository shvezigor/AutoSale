import { Buffer } from 'node:buffer';

import { z } from 'zod';

const isCanonicalIntegrationEncryptionKey = (value: string): boolean => {
  const decoded = Buffer.from(value, 'base64');
  return decoded.length === 32 && decoded.toString('base64') === value;
};

export const workerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  HEALTH_PORT: z.coerce.number().int().positive().default(3002),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(3),
  S3_ACCESS_KEY_ID: z.string().min(8),
  S3_SECRET_ACCESS_KEY: z.string().min(8),
  OPENAI_API_KEY: z.string().min(20),
  OPENAI_MODEL: z.string().min(1).default('gpt-5.4-mini'),
  META_APP_ID: z.string().regex(/^\d{5,32}$/),
  META_APP_SECRET: z.string().min(16),
  META_GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/),
  INTEGRATION_ENCRYPTION_KEY: z.string().refine(
    isCanonicalIntegrationEncryptionKey,
    'must be canonical base64 encoding of 32 bytes',
  ),
  GOOGLE_SERVICE_ACCOUNT_FILE: z.preprocess((value) => value === '' ? undefined : value, z.string().min(1).optional()),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function parseWorkerEnv(input: unknown): WorkerEnv {
  return workerEnvSchema.parse(input);
}
