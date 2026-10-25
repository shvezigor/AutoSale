import { describe, expect, it } from 'vitest';
import * as conversationContracts from './conversations.js';

import {
  conversationDetailResponseSchema,
  conversationStatusChangeInputSchema,
  conversationStatusChangeResponseSchema,
  conversationStatusCountsSchema,
  conversationQuerySchema,
  conversationSummarySchema,
  conversationListResponseSchema,
  outboundDeliverySchema,
  replyCapabilitySchema,
} from './conversations.js';

const profile = {
  participantName: 'Олена Коваль',
  participantUsername: 'olena.koval',
  participantAvatarUrl: '/api/media/profiles/33333333-3333-4333-8333-333333333333',
};

describe('conversation profile contracts', () => {
  it('validates workflow input, response, counts and optional filtering', () => {
    expect(() => conversationStatusChangeInputSchema.parse({ status: 'ARCHIVED', expectedVersion: 0 })).toThrow();
    for (const expectedVersion of [-1, 0.5]) {
      expect(() => conversationStatusChangeInputSchema.parse({ status: 'CLOSED', expectedVersion })).toThrow();
    }
    expect(conversationStatusChangeInputSchema.parse({ status: 'CLOSED', expectedVersion: 0 })).toEqual({ status: 'CLOSED', expectedVersion: 0 });
    expect(conversationStatusChangeResponseSchema.parse({ status: 'ACTIVE', statusVersion: 0, statusChangedAt: null })).toEqual({ status: 'ACTIVE', statusVersion: 0, statusChangedAt: null });
    expect(conversationStatusCountsSchema.parse({ ACTIVE: 2, INACTIVE: 1, CLOSED: 0 })).toEqual({ ACTIVE: 2, INACTIVE: 1, CLOSED: 0 });
    expect(() => conversationStatusCountsSchema.parse({ ACTIVE: -1, INACTIVE: 0, CLOSED: 0 })).toThrow();
    expect(conversationQuerySchema.parse({ status: 'INACTIVE' }).status).toBe('INACTIVE');
    expect(conversationQuerySchema.parse({}).status).toBeUndefined();
    expect(() => conversationQuerySchema.parse({ status: 'ARCHIVED' })).toThrow();
  });

  it('requires workflow status and version on summaries and details', () => {
    const summary = { id: '11111111-1111-4111-8111-111111111111', channel: 'INSTAGRAM', ...profile, lastMessagePreview: null, lastMessageAt: '2026-10-25T10:00:00.000Z' };
    expect(() => conversationSummarySchema.parse(summary)).toThrow();
    expect(() => conversationSummarySchema.parse({ ...summary, workflowStatus: 'ACTIVE' })).toThrow();
    expect(() => conversationSummarySchema.parse({ ...summary, statusVersion: 0 })).toThrow();
    expect(() => conversationDetailResponseSchema.parse({ id: summary.id, channel: summary.channel, ...profile, replyCapability: { enabled: false, aiDraftSendAllowed: false, reason: 'NOT_CONNECTED' }, messages: [] })).toThrow();
  });

  it('accepts TikTok as a bounded social channel', () => {
    const tiktok = conversationListResponseSchema.parse({
      items: [{
        id: '11111111-1111-4111-8111-111111111111',
        channel: 'TIKTOK', workflowStatus: 'ACTIVE', statusVersion: 0,
        ...profile,
        lastMessagePreview: 'Вітаю з TikTok',
        lastMessageAt: '2026-10-04T10:00:00.000Z',
      }],
      nextCursor: null,
    });

    expect(tiktok.items[0]?.channel).toBe('TIKTOK');
  });

  it('accepts Facebook conversations without widening the channel vocabulary', () => {
    const facebook = conversationListResponseSchema.parse({
      items: [{
        id: '11111111-1111-4111-8111-111111111111',
        channel: 'FACEBOOK', workflowStatus: 'ACTIVE', statusVersion: 0,
        ...profile,
        lastMessagePreview: 'Вітаю',
        lastMessageAt: '2026-10-02T10:00:00.000Z',
      }],
      nextCursor: null,
    });

    expect(facebook.items[0]?.channel).toBe('FACEBOOK');
    expect(() => conversationListResponseSchema.parse({
      items: [{ ...facebook.items[0], channel: 'WHATSAPP' }],
      nextCursor: null,
    })).toThrow();
  });

  it('represents the inbound-only Facebook reply capability explicitly', () => {
    const parsed = conversationDetailResponseSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      channel: 'FACEBOOK', workflowStatus: 'ACTIVE', statusVersion: 0,
      participantName: 'Олена',
      participantUsername: null,
      participantAvatarUrl: null,
      replyCapability: { enabled: false, aiDraftSendAllowed: false, reason: 'CHANNEL_READ_ONLY' },
      messages: [],
    });

    expect(parsed.replyCapability).toEqual({ enabled: false, aiDraftSendAllowed: false, reason: 'CHANNEL_READ_ONLY' });
  });

  it('retains additive profile fields in conversation list responses', () => {
    const parsed = conversationListResponseSchema.parse({
      items: [{
        id: '11111111-1111-4111-8111-111111111111',
        channel: 'INSTAGRAM', workflowStatus: 'ACTIVE', statusVersion: 0,
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
      channel: 'INSTAGRAM', workflowStatus: 'ACTIVE', statusVersion: 0,
      participantName: null,
      participantUsername: null,
      participantAvatarUrl: null,
      replyCapability: { enabled: false, aiDraftSendAllowed: false, reason: 'NOT_CONNECTED' },
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
      channel: 'INSTAGRAM', workflowStatus: 'ACTIVE', statusVersion: 0,
      participantName: 'Олена',
      participantUsername: 'olena',
      participantAvatarUrl: null,
      replyCapability: { enabled: true, aiDraftSendAllowed: true, reason: null },
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

    expect(parsed.replyCapability).toEqual({ enabled: true, aiDraftSendAllowed: true, reason: null });
    expect(parsed.messages[0]?.delivery).toEqual({ status: 'PENDING', attempts: 0, errorCode: null, retryAllowed: false });
  });

  it('accepts bounded TikTok reply capability and delivery errors', () => {
    expect(replyCapabilitySchema.parse({
      enabled: false,
      aiDraftSendAllowed: false,
      reason: 'TIKTOK_CAPABILITY_UNAVAILABLE',
    })).toEqual({ enabled: false, aiDraftSendAllowed: false, reason: 'TIKTOK_CAPABILITY_UNAVAILABLE' });

    expect(outboundDeliverySchema.parse({
      status: 'FAILED',
      attempts: 1,
      errorCode: 'TIKTOK_RATE_LIMITED',
      retryAllowed: true,
    }).errorCode).toBe('TIKTOK_RATE_LIMITED');

    for (const errorCode of [
      'TIKTOK_RECONNECT_REQUIRED',
      'TIKTOK_SEND_FAILED',
      'TIKTOK_DELIVERY_UNKNOWN',
      'TIKTOK_REPLY_NOT_PERMITTED',
    ]) {
      expect(outboundDeliverySchema.parse({
        status: 'FAILED', attempts: 1, errorCode, retryAllowed: false,
      }).errorCode).toBe(errorCode);
    }
  });

  it('retains expired reply-window capability and delivery errors', () => {
    const parsed = conversationDetailResponseSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      channel: 'INSTAGRAM', workflowStatus: 'ACTIVE', statusVersion: 0,
      participantName: 'Олена',
      participantUsername: 'olena',
      participantAvatarUrl: null,
      replyCapability: { enabled: false, aiDraftSendAllowed: false, reason: 'REPLY_WINDOW_EXPIRED' },
      messages: [{
        id: '22222222-2222-4222-8222-222222222222',
        direction: 'OUTBOUND',
        senderId: 'shop',
        text: 'Доброго дня!',
        sourceTimestamp: '2026-09-07T12:00:00.000Z',
        attachments: [],
        delivery: {
          status: 'FAILED', attempts: 1,
          errorCode: 'INSTAGRAM_HUMAN_AGENT_UNAVAILABLE', retryAllowed: false,
        },
      }],
    });

    expect(parsed.replyCapability.reason).toBe('REPLY_WINDOW_EXPIRED');
    expect(parsed.messages[0]?.delivery?.errorCode).toBe('INSTAGRAM_HUMAN_AGENT_UNAVAILABLE');
  });

  it('distinguishes manual reply eligibility from AI-draft sending', () => {
    const parsed = conversationDetailResponseSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      channel: 'INSTAGRAM', workflowStatus: 'ACTIVE', statusVersion: 0,
      participantName: 'Fictional customer',
      participantUsername: null,
      participantAvatarUrl: null,
      replyCapability: { enabled: true, reason: null, aiDraftSendAllowed: false },
      messages: [],
    });

    expect(parsed.replyCapability).toEqual({ enabled: true, reason: null, aiDraftSendAllowed: false });
  });

  it('retains image, video, link, and unsupported Instagram attachments', () => {
    const parsed = conversationDetailResponseSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      channel: 'INSTAGRAM', workflowStatus: 'ACTIVE', statusVersion: 0,
      participantName: 'Олена',
      participantUsername: 'olena',
      participantAvatarUrl: null,
      replyCapability: { enabled: true, aiDraftSendAllowed: true, reason: null },
      messages: [{
        id: '22222222-2222-4222-8222-222222222222',
        direction: 'INBOUND',
        senderId: 'customer',
        text: null,
        sourceTimestamp: '2026-09-24T10:00:00.000Z',
        attachments: [
          { id: '22222222-2222-4222-8222-222222222222', type: 'VIDEO', mediaUrl: '/api/media/22222222-2222-4222-8222-222222222222', copyStatus: 'COPIED' },
          { id: '33333333-3333-4333-8333-333333333333', type: 'LINK', mediaUrl: 'https://www.instagram.com/reel/fictional', copyStatus: 'NOT_REQUIRED' },
          { id: '44444444-4444-4444-8444-444444444444', type: 'UNSUPPORTED', mediaUrl: null, copyStatus: 'NOT_REQUIRED' },
        ],
        delivery: null,
      }],
    });

    expect(parsed.messages[0]?.attachments).toEqual([
      expect.objectContaining({ type: 'VIDEO', mediaUrl: '/api/media/22222222-2222-4222-8222-222222222222' }),
      expect.objectContaining({ type: 'LINK', mediaUrl: 'https://www.instagram.com/reel/fictional' }),
      expect.objectContaining({ type: 'UNSUPPORTED', mediaUrl: null }),
    ]);
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
