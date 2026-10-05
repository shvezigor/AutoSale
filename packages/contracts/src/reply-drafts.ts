import { z } from 'zod';

export const replyToneSchema = z.enum(['FRIENDLY', 'NEUTRAL', 'FORMAL']);
export const replyAddressFormSchema = z.enum(['FORMAL_YOU', 'INFORMAL_YOU']);
export const replyDraftStatusSchema = z.enum([
  'QUEUED', 'PROCESSING', 'READY', 'USED', 'STALE', 'BLOCKED', 'FAILED',
]);
export const replyDraftOutcomeSchema = z.enum(['ANSWER', 'CLARIFY', 'HANDOFF']);
export const replyDraftTriggerSourceSchema = z.enum(['MANUAL', 'AUTOMATIC']);

export const replyStyleSchema = z.strictObject({
  tenantId: z.uuid(),
  enabled: z.boolean(),
  companyName: z.string().trim().max(120),
  tone: replyToneSchema,
  addressForm: replyAddressFormSchema,
  guidance: z.string().trim().max(500),
});

export const replyStylePatchSchema = replyStyleSchema.omit({ tenantId: true }).partial()
  .refine((value) => !value.enabled || value.companyName === undefined || Boolean(value.companyName.trim()), {
    path: ['companyName'],
    message: 'COMPANY_NAME_REQUIRED',
  });

export const createReplyDraftSchema = z.strictObject({
  idempotencyKey: z.uuid(),
});

export const replyDraftJobSchema = z.strictObject({
  tenantId: z.uuid(),
  draftId: z.uuid(),
});

export const replyDraftSourceSchema = z.object({
  productId: z.uuid(),
  sku: z.string().max(120),
  name: z.string().max(300),
  variants: z.record(z.string().max(80), z.string().max(160)),
  price: z.string().nullable(),
  currency: z.string().max(8).nullable(),
  stockQuantity: z.number().int().min(0).nullable(),
  updatedAt: z.iso.datetime(),
});

export const replyDraftSummarySchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  anchorMessageId: z.uuid(),
  triggerSource: replyDraftTriggerSourceSchema,
  availableAt: z.iso.datetime(),
  status: replyDraftStatusSchema,
  outcome: replyDraftOutcomeSchema.nullable(),
  generatedText: z.string().max(2000).nullable(),
  finalText: z.string().max(2000).nullable(),
  sources: z.array(replyDraftSourceSchema).max(8),
  errorCode: z.enum([
    'NO_SAFE_CANDIDATES', 'UNGROUNDED_CLAIM', 'SOURCE_CHANGED',
    'NEW_MESSAGE', 'PROVIDER_UNAVAILABLE', 'INVALID_RESPONSE',
    'FEATURE_DISABLED', 'TENANT_FROZEN',
  ]).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type ReplyStyle = z.infer<typeof replyStyleSchema>;
export type ReplyStylePatch = z.infer<typeof replyStylePatchSchema>;
export type CreateReplyDraftInput = z.infer<typeof createReplyDraftSchema>;
export type ReplyDraftJob = z.infer<typeof replyDraftJobSchema>;
export type ReplyDraftSource = z.infer<typeof replyDraftSourceSchema>;
export type ReplyDraftTriggerSource = z.infer<typeof replyDraftTriggerSourceSchema>;
export type ReplyDraftSummary = z.infer<typeof replyDraftSummarySchema>;
