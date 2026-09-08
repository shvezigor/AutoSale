import { z } from 'zod';

export const telegramLinkPurposeSchema = z.enum(['PERSONAL', 'SUPPLIER_GROUP']);
export const telegramDeliveryPurposeSchema = z.enum(['TEST', 'SUPPLIER_ORDER', 'PERSONAL_ALERT']);
export const telegramDeliveryStatusSchema = z.enum(['PENDING', 'PROCESSING', 'SUCCEEDED', 'RETRYABLE', 'FAILED']);

const telegramPersonalBindingSummarySchema = z.object({
  connected: z.boolean(),
  displayName: z.string().min(1).max(128).nullable(),
  username: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{4,31}$/).nullable(),
  linkedAt: z.string().datetime().nullable(),
}).strict();

export const telegramConnectionSummarySchema = z.object({
  available: z.boolean(),
  botUsername: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{4,31}$/).nullable(),
  personal: telegramPersonalBindingSummarySchema,
}).strict();

export const telegramLinkResponseSchema = z.object({
  url: z.string().url().refine((value) => new URL(value).hostname === 't.me', 'Telegram link must use t.me'),
  expiresAt: z.string().datetime(),
}).strict();

export const telegramDeliveryJobSchema = z.object({
  deliveryId: z.string().uuid(),
}).strict();

export type TelegramLinkPurpose = z.infer<typeof telegramLinkPurposeSchema>;
export type TelegramDeliveryPurpose = z.infer<typeof telegramDeliveryPurposeSchema>;
export type TelegramDeliveryStatus = z.infer<typeof telegramDeliveryStatusSchema>;
export type TelegramConnectionSummary = z.infer<typeof telegramConnectionSummarySchema>;
export type TelegramLinkResponse = z.infer<typeof telegramLinkResponseSchema>;
export type TelegramDeliveryJob = z.infer<typeof telegramDeliveryJobSchema>;
