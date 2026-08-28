import { z } from 'zod';

export const instagramConnectionStatusSchema = z.enum([
  'NOT_CONNECTED',
  'LEGACY',
  'ACTIVE',
  'REAUTH_REQUIRED',
  'ERROR',
  'DISCONNECTED',
]);

export const instagramConnectionSummarySchema = z
  .object({
    status: instagramConnectionStatusSchema,
    accountId: z.string().nullable(),
    username: z.string().nullable(),
    tokenExpiresAt: z.string().datetime().nullable(),
    lastVerifiedAt: z.string().datetime().nullable(),
    lastErrorCode: z.string().nullable(),
  })
  .strict();

export type InstagramConnectionStatus = z.infer<typeof instagramConnectionStatusSchema>;
export type InstagramConnectionSummary = z.infer<typeof instagramConnectionSummarySchema>;
