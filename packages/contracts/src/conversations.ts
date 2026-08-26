import { z } from 'zod';

export const conversationQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const conversationSummarySchema = z.object({
  id: z.string().uuid(),
  channel: z.literal('INSTAGRAM'),
  participantName: z.string().nullable(),
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

export const conversationMessageSchema = z.object({
  id: z.string().uuid(),
  direction: z.enum(['INBOUND', 'OUTBOUND']),
  senderId: z.string(),
  text: z.string().nullable(),
  sourceTimestamp: z.string().datetime(),
  attachments: z.array(conversationAttachmentSchema),
});

export const conversationDetailResponseSchema = z.object({
  id: z.string().uuid(),
  channel: z.literal('INSTAGRAM'),
  participantName: z.string().nullable(),
  messages: z.array(conversationMessageSchema),
});

export type ConversationQuery = z.infer<typeof conversationQuerySchema>;
export type ConversationListResponse = z.infer<typeof conversationListResponseSchema>;
export type ConversationDetailResponse = z.infer<typeof conversationDetailResponseSchema>;
