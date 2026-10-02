import { z } from 'zod';

export const facebookConnectionStatusSchema = z.enum([
  'NOT_CONNECTED',
  'ACTIVE',
  'REAUTH_REQUIRED',
  'ERROR',
  'DISCONNECTED',
]);

export const facebookCleanupStatusSchema = z.enum(['NONE', 'PENDING', 'FAILED']);

export const facebookPageCandidateSchema = z.object({
  pageId: z.string().min(1).max(128),
  pageName: z.string().min(1).max(255),
}).strict();

export const facebookPageSelectionInputSchema = z.object({
  attemptId: z.string().uuid(),
  pageId: z.string().min(1).max(128),
}).strict();

export const facebookConnectionSummarySchema = z.object({
  status: facebookConnectionStatusSchema,
  pageId: z.string().nullable(),
  pageName: z.string().nullable(),
  tokenExpiresAt: z.string().datetime().nullable(),
  lastVerifiedAt: z.string().datetime().nullable(),
  lastErrorCode: z.string().nullable(),
  cleanupStatus: facebookCleanupStatusSchema,
  cleanupErrorCode: z.string().nullable(),
}).strict();

export type FacebookConnectionStatus = z.infer<typeof facebookConnectionStatusSchema>;
export type FacebookCleanupStatus = z.infer<typeof facebookCleanupStatusSchema>;
export type FacebookPageCandidate = z.infer<typeof facebookPageCandidateSchema>;
export type FacebookPageSelectionInput = z.infer<typeof facebookPageSelectionInputSchema>;
export type FacebookConnectionSummary = z.infer<typeof facebookConnectionSummarySchema>;
