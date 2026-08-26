import type { ConversationListResponse } from '../../../../packages/contracts/src/conversations';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ConversationList } from './conversation-list';

const fixtureSummary: ConversationListResponse['items'][number] = {
  id: '11111111-1111-4111-8111-111111111111',
  channel: 'INSTAGRAM',
  participantName: 'Олена',
  lastMessagePreview: 'Хочу чорну модель 38 розміру',
  lastMessageAt: '2026-08-26T08:00:00.123Z',
};

describe('ConversationList', () => {
  it('links each named customer to the conversation detail', () => {
    render(<ConversationList conversations={[fixtureSummary]} />);

    expect(screen.getByRole('link', { name: /Олена/i })).toHaveAttribute(
      'href',
      `/conversations/${fixtureSummary.id}`,
    );
    expect(screen.getByText('Хочу чорну модель 38 розміру')).toBeVisible();
  });

  it('renders an explicit empty state', () => {
    render(<ConversationList conversations={[]} />);

    expect(screen.getByText('Діалогів поки немає')).toBeVisible();
  });
});
