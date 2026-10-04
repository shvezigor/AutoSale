import { z } from 'zod';

export const tikTokConnectionStatusSchema = z.enum([
  'NOT_CONNECTED',
  'ACTIVE',
  'INBOUND_ONLY',
  'REAUTH_REQUIRED',
  'ERROR',
  'DISCONNECTED',
]);

export const tikTokCleanupStatusSchema = z.enum(['NONE', 'PENDING', 'FAILED']);

export const tikTokCapabilitiesSchema = z.object({
  receiveMessages: z.boolean(),
  sendText: z.boolean(),
  sendImage: z.boolean(),
}).strict();

export const tikTokConnectionSummarySchema = z.object({
  status: tikTokConnectionStatusSchema,
  accountId: z.string().min(1).max(128).nullable(),
  displayName: z.string().min(1).max(255).nullable(),
  capabilities: tikTokCapabilitiesSchema.nullable(),
  tokenExpiresAt: z.string().datetime().nullable(),
  lastVerifiedAt: z.string().datetime().nullable(),
  lastErrorCode: z.string().nullable(),
  cleanupStatus: tikTokCleanupStatusSchema,
}).strict();

export const tikTokOAuthStartResponseSchema = z.object({
  authorizationUrl: z.string().url(),
}).strict();

export type TikTokConnectionStatus = z.infer<typeof tikTokConnectionStatusSchema>;
export type TikTokCleanupStatus = z.infer<typeof tikTokCleanupStatusSchema>;
export type TikTokCapabilities = z.infer<typeof tikTokCapabilitiesSchema>;
export type TikTokConnectionSummary = z.infer<typeof tikTokConnectionSummarySchema>;
export type TikTokOAuthStartResponse = z.infer<typeof tikTokOAuthStartResponseSchema>;
