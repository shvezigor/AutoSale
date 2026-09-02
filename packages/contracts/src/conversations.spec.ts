import { describe, expect, it } from 'vitest';

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
      messages: [],
    });

    expect(parsed).toMatchObject({
      participantName: null,
      participantUsername: null,
      participantAvatarUrl: null,
    });
  });
});
