import { Buffer } from 'node:buffer';

import { z } from 'zod';

const isCanonicalIntegrationEncryptionKey = (value: string): boolean => {
  const decoded = Buffer.from(value, 'base64');

  return decoded.length === 32 && decoded.toString('base64') === value;
};

const optionalNonEmptyString = z.preprocess((value) => value === '' ? undefined : value, z.string().min(1).optional());
const optionalUrl = z.preprocess((value) => value === '' ? undefined : value, z.string().url().optional());
const optionalBoolean = z.preprocess(
  (value) => value === undefined || value === '' ? undefined : value === true || value === 'true',
  z.boolean().default(false),
);

export const apiEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  DEFAULT_TENANT_ID: z.string().uuid(),
  DEFAULT_TENANT_KEY: z.string().min(1).default('default'),
  META_VERIFY_TOKEN: z.string().min(24),
  META_APP_SECRET: z.string().min(16),
  META_APP_ID: z.string().regex(/^\d{5,32}$/),
  META_GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/),
  INTEGRATION_ENCRYPTION_KEY: z.string().refine(
    isCanonicalIntegrationEncryptionKey,
    'must be canonical base64 encoding of 32 bytes',
  ),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(3),
  S3_ACCESS_KEY_ID: z.string().min(8),
  S3_SECRET_ACCESS_KEY: z.string().min(8),
  GOOGLE_SERVICE_ACCOUNT_FILE: z.preprocess((value) => value === '' ? undefined : value, z.string().min(1).optional()),
  GOOGLE_OAUTH_CLIENT_ID: optionalNonEmptyString,
  GOOGLE_OAUTH_CLIENT_SECRET: optionalNonEmptyString,
  GOOGLE_OAUTH_REDIRECT_URI: optionalUrl,
  GOOGLE_SIGN_IN_ENABLED: optionalBoolean,
  GOOGLE_SIGN_IN_REDIRECT_URI: optionalUrl,
  SESSION_COOKIE_NAME: z.string().regex(/^[A-Za-z0-9_-]+$/).default('autosale_session'),
  SESSION_PEPPER: z.string().min(32),
  AUTH_TOKEN_PEPPER: z.string().min(32),
  APP_PUBLIC_URL: z.string().url(),
  SMTP_HOST: z.preprocess((value) => value === '' ? undefined : value, z.string().min(1).optional()),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.preprocess((value) => value === '' ? undefined : value, z.string().min(1).optional()),
  SMTP_PASSWORD: z.preprocess((value) => value === '' ? undefined : value, z.string().min(1).optional()),
  SMTP_FROM: z.preprocess((value) => value === '' ? undefined : value, z.string().min(3).optional()),
}).superRefine((environment, context) => {
  const googleOAuthValues = [
    environment.GOOGLE_OAUTH_CLIENT_ID,
    environment.GOOGLE_OAUTH_CLIENT_SECRET,
    environment.GOOGLE_OAUTH_REDIRECT_URI,
  ];
  const configuredValues = googleOAuthValues.filter((value) => value !== undefined);

  if (configuredValues.length > 0 && configuredValues.length !== googleOAuthValues.length) {
    context.addIssue({
      code: 'custom',
      message: 'Google OAuth configuration must include client ID, client secret, and redirect URI',
    });
  }

  if (environment.NODE_ENV === 'production' && environment.GOOGLE_OAUTH_REDIRECT_URI?.startsWith('http://')) {
    context.addIssue({
      code: 'custom',
      path: ['GOOGLE_OAUTH_REDIRECT_URI'],
      message: 'Google OAuth redirect URI must use HTTPS in production',
    });
  }

  if (environment.GOOGLE_SIGN_IN_ENABLED && (
    !environment.GOOGLE_OAUTH_CLIENT_ID
    || !environment.GOOGLE_OAUTH_CLIENT_SECRET
    || !environment.GOOGLE_SIGN_IN_REDIRECT_URI
  )) {
    context.addIssue({
      code: 'custom',
      message: 'Google Sign-In configuration must include client ID, client secret, and redirect URI',
    });
  }

  if (environment.NODE_ENV === 'production' && environment.GOOGLE_SIGN_IN_REDIRECT_URI?.startsWith('http://')) {
    context.addIssue({
      code: 'custom',
      path: ['GOOGLE_SIGN_IN_REDIRECT_URI'],
      message: 'Google Sign-In redirect URI must use HTTPS in production',
    });
  }
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export function parseApiEnv(input: unknown): ApiEnv {
  return apiEnvSchema.parse(input);
}
