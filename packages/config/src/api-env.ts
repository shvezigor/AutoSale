import { z } from 'zod';

export const apiEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  META_VERIFY_TOKEN: z.string().min(24),
  META_APP_SECRET: z.string().min(16),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export function parseApiEnv(input: unknown): ApiEnv {
  return apiEnvSchema.parse(input);
}
