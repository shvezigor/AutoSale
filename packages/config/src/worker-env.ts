import { Buffer } from 'node:buffer';

import { z } from 'zod';

const optionalNonEmptyString = z.preprocess((value) => value === '' ? undefined : value, z.string().min(1).optional());
const canonicalEncryptionKey = z.string().refine((value) => {
  const decoded = Buffer.from(value, 'base64');
  return decoded.length === 32 && decoded.toString('base64') === value;
}, 'must be canonical base64 encoding of 32 bytes');

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
  GOOGLE_SERVICE_ACCOUNT_FILE: z.preprocess((value) => value === '' ? undefined : value, z.string().min(1).optional()),
  INTEGRATION_ENCRYPTION_KEY: canonicalEncryptionKey,
  GOOGLE_OAUTH_CLIENT_ID: optionalNonEmptyString,
  GOOGLE_OAUTH_CLIENT_SECRET: optionalNonEmptyString,
}).superRefine((environment, context) => {
  if ((environment.GOOGLE_OAUTH_CLIENT_ID === undefined) !== (environment.GOOGLE_OAUTH_CLIENT_SECRET === undefined)) {
    context.addIssue({ code: 'custom', message: 'Google OAuth worker configuration must include client ID and client secret' });
  }
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function parseWorkerEnv(input: unknown): WorkerEnv {
  return workerEnvSchema.parse(input);
}
