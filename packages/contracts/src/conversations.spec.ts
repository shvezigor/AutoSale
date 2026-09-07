import { describe, expect, it } from 'vitest';
import * as conversationContracts from './conversations.js';

import {
  conversationDetailResponseSchema,
  conversationListResponseSchema,
} from './conversations.js';

const profile = {
  participantName: 'Олена Коваль',
  participantUsername: 'olena.koval',
  participantAvatarUrl: '/api/media/profiles/33333333-3333-4333-8333-333333333333',
};

describe('conversation profile contracts', () => {
  it('retains additive profile fields in conversation list responses', () => {
    const parsed = conversationListResponseSchema.parse({
      items: [{
        id: '11111111-1111-4111-8111-111111111111',
        channel: 'INSTAGRAM',
        ...profile,
        lastMessagePreview: 'Вітаю',
        lastMessageAt: '2026-09-02T10:00:00.000Z',
      }],
      nextCursor: null,
    });

    expect(parsed.items[0]).toMatchObject(profile);
  });

  it('retains nullable profile fields in conversation detail responses', () => {
    const parsed = conversationDetailResponseSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      channel: 'INSTAGRAM',
      participantName: null,
      participantUsername: null,
      participantAvatarUrl: null,
      replyCapability: { enabled: false, reason: 'NOT_CONNECTED' },
      messages: [],
    });

    expect(parsed).toMatchObject({
      participantName: null,
      participantUsername: null,
      participantAvatarUrl: null,
    });
  });

  it('retains outbound delivery state and reply capability', () => {
    const parsed = conversationDetailResponseSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      channel: 'INSTAGRAM',
      participantName: 'Олена',
      participantUsername: 'olena',
      participantAvatarUrl: null,
      replyCapability: { enabled: true, reason: null },
      messages: [{
        id: '22222222-2222-4222-8222-222222222222',
        direction: 'OUTBOUND',
        senderId: 'shop',
        text: 'Доброго дня!',
        sourceTimestamp: '2026-09-07T12:00:00.000Z',
        attachments: [],
        delivery: { status: 'PENDING', attempts: 0, errorCode: null, retryAllowed: false },
      }],
    });

    expect(parsed.replyCapability).toEqual({ enabled: true, reason: null });
    expect(parsed.messages[0]?.delivery).toEqual({ status: 'PENDING', attempts: 0, errorCode: null, retryAllowed: false });
  });

  it('validates trimmed Instagram reply input at its boundaries', () => {
    const schema = (conversationContracts as unknown as Record<string, { parse(value: unknown): unknown }>).outboundMessageInputSchema;
    expect(schema).toBeDefined();
    if (!schema) return;

    expect(schema.parse({ text: ' Вітаю ', idempotencyKey: '33333333-3333-4333-8333-333333333333' })).toEqual({
      text: 'Вітаю',
      idempotencyKey: '33333333-3333-4333-8333-333333333333',
    });
    expect(() => schema.parse({ text: '   ', idempotencyKey: '33333333-3333-4333-8333-333333333333' })).toThrow();
    expect(() => schema.parse({ text: 'x'.repeat(1001), idempotencyKey: '33333333-3333-4333-8333-333333333333' })).toThrow();
    expect(() => schema.parse({ text: 'Вітаю', idempotencyKey: 'not-a-uuid' })).toThrow();
  });
});
