import type { ConversationDetailResponse } from '../../../../packages/contracts/src/conversations';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MessageThread } from './message-thread';

const detail: ConversationDetailResponse = {
  id: '11111111-1111-4111-8111-111111111111',
  channel: 'INSTAGRAM',
  participantName: 'Олена',
  messages: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      direction: 'INBOUND',
      senderId: 'ig-user-100',
      text: 'Хочу чорну модель 38 розміру',
      sourceTimestamp: '2026-08-26T08:00:00.123Z',
      attachments: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          type: 'IMAGE',
          mediaUrl: '/api/media/33333333-3333-4333-8333-333333333333',
          copyStatus: 'COPIED',
        },
        {
          id: '44444444-4444-4444-8444-444444444444',
          type: 'IMAGE',
          mediaUrl: '/api/media/44444444-4444-4444-8444-444444444444',
          copyStatus: 'FAILED',
        },
      ],
    },
    {
      id: '55555555-5555-4555-8555-555555555555',
      direction: 'OUTBOUND',
      senderId: 'manager',
      text: 'Дякую, беремо замовлення в роботу',
      sourceTimestamp: '2026-08-26T08:02:00.000Z',
      attachments: [],
    },
  ],
};

describe('MessageThread', () => {
  it('renders direction labels, localized times, text, media, and failure state', () => {
    render(<MessageThread conversation={detail} />);

    expect(screen.getByText('Вхідне')).toBeVisible();
    expect(screen.getByText('Вихідне')).toBeVisible();
    expect(screen.getByText('Хочу чорну модель 38 розміру')).toBeVisible();
    expect(screen.getByText(/11:00/)).toBeVisible();
    expect(screen.getByRole('img', { name: /вкладення з Instagram/i })).toBeVisible();
    expect(screen.getByText('Не вдалося завантажити вкладення')).toBeVisible();
  });
});
