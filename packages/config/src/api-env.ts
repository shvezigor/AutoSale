import { z } from 'zod';

export const apiEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  DEFAULT_TENANT_ID: z.string().uuid(),
  DEFAULT_TENANT_KEY: z.string().min(1).default('default'),
  META_VERIFY_TOKEN: z.string().min(24),
  META_APP_SECRET: z.string().min(16),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(3),
  S3_ACCESS_KEY_ID: z.string().min(8),
  S3_SECRET_ACCESS_KEY: z.string().min(8),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export function parseApiEnv(input: unknown): ApiEnv {
  return apiEnvSchema.parse(input);
}
