import { z } from 'zod';

export const conversationQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const conversationSummarySchema = z.object({
  id: z.string().uuid(),
  channel: z.literal('INSTAGRAM'),
  participantName: z.string().nullable(),
  participantUsername: z.string().nullable(),
  participantAvatarUrl: z.string().nullable(),
  lastMessagePreview: z.string().nullable(),
  lastMessageAt: z.string().datetime(),
});

export const conversationListResponseSchema = z.object({
  items: z.array(conversationSummarySchema),
  nextCursor: z.string().nullable(),
});

export const conversationAttachmentSchema = z.object({
  id: z.string().uuid(),
  type: z.literal('IMAGE'),
  mediaUrl: z.string(),
  copyStatus: z.string(),
});

export const outboundDeliverySchema = z.object({
  status: z.enum(['PENDING', 'SENDING', 'SENT', 'FAILED', 'UNKNOWN']),
  attempts: z.number().int().min(0),
  errorCode: z.enum([
    'INSTAGRAM_RECONNECT_REQUIRED',
    'INSTAGRAM_RATE_LIMITED',
    'INSTAGRAM_SEND_FAILED',
    'INSTAGRAM_DELIVERY_UNKNOWN',
  ]).nullable(),
  retryAllowed: z.boolean(),
});

export const outboundMessageInputSchema = z.object({
  text: z.string().trim().min(1).max(1000),
  idempotencyKey: z.string().uuid(),
});

export const replyCapabilitySchema = z.object({
  enabled: z.boolean(),
  reason: z.enum(['NOT_CONNECTED', 'RECONNECT_REQUIRED']).nullable(),
});

export const conversationMessageSchema = z.object({
  id: z.string().uuid(),
  direction: z.enum(['INBOUND', 'OUTBOUND']),
  senderId: z.string(),
  text: z.string().nullable(),
  sourceTimestamp: z.string().datetime(),
  attachments: z.array(conversationAttachmentSchema),
  delivery: outboundDeliverySchema.nullable(),
});

export const conversationDetailResponseSchema = z.object({
  id: z.string().uuid(),
  channel: z.literal('INSTAGRAM'),
  participantName: z.string().nullable(),
  participantUsername: z.string().nullable(),
  participantAvatarUrl: z.string().nullable(),
  replyCapability: replyCapabilitySchema,
  messages: z.array(conversationMessageSchema),
});

export const conversationOrderSummarySchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['AI_PROCESSING', 'AI_FAILED', 'NEEDS_REVIEW', 'AUTO_APPROVED', 'APPROVED', 'CANCELLED']),
});

export const conversationOrderStateSchema = z.object({
  order: conversationOrderSummarySchema.nullable(),
});

export const conversationOrderStartResponseSchema = z.object({
  orderId: z.string().uuid().nullable(),
  queued: z.boolean(),
});

export type ConversationQuery = z.infer<typeof conversationQuerySchema>;
export type ConversationListResponse = z.infer<typeof conversationListResponseSchema>;
export type ConversationDetailResponse = z.infer<typeof conversationDetailResponseSchema>;
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;
export type OutboundMessageInput = z.infer<typeof outboundMessageInputSchema>;
export type ReplyCapability = z.infer<typeof replyCapabilitySchema>;
export type ConversationOrderState = z.infer<typeof conversationOrderStateSchema>;
export type ConversationOrderStartResponse = z.infer<typeof conversationOrderStartResponseSchema>;
