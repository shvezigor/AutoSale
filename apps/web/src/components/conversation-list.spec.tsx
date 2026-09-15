import type { ConversationListResponse } from '../../../../packages/contracts/src/conversations';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { I18nProvider } from '../i18n/i18n-provider';
import { ConversationList } from './conversation-list';

const fixtureSummary: ConversationListResponse['items'][number] = {
  id: '11111111-1111-4111-8111-111111111111',
  channel: 'INSTAGRAM',
  participantName: 'Олена',
  participantUsername: 'olena',
  participantAvatarUrl: '/api/media/instagram-profiles/profile-a/avatar?v=v1',
  lastMessagePreview: 'Хочу чорну модель 38 розміру',
  lastMessageAt: '2026-08-26T08:00:00.123Z',
};

afterEach(cleanup);

describe('ConversationList', () => {
  it('links each named customer to the conversation detail', () => {
    render(<ConversationList conversations={[fixtureSummary]} />);

    expect(screen.getByRole('link', { name: /Олена/i })).toHaveAttribute(
      'href',
      `/conversations/${fixtureSummary.id}`,
    );
    expect(screen.getByText('Хочу чорну модель 38 розміру')).toBeVisible();
    expect(screen.getByRole('img', { name: 'Фото профілю Олена' })).toHaveAttribute(
      'src',
      fixtureSummary.participantAvatarUrl,
    );
  });

  it('renders the current username when the API suppresses a stale legacy name', () => {
    render(<ConversationList conversations={[{
      ...fixtureSummary,
      participantName: null,
      participantUsername: 'username_only',
      participantAvatarUrl: null,
    }]} />);

    const link = screen.getByRole('link', { name: /@username_only/i });
    expect(link).toBeVisible();
    expect(link.querySelector('img')).toBeNull();
  });

  it('uses the Instagram customer fallback only when both Meta fields are absent', () => {
    render(<ConversationList conversations={[{
      ...fixtureSummary,
      participantName: null,
      participantUsername: null,
      participantAvatarUrl: null,
    }]} />);

    expect(screen.getByText('Клієнт Instagram')).toBeVisible();
  });

  it('renders an explicit empty state', () => {
    render(<ConversationList conversations={[]} />);

    expect(screen.getByText('Діалогів поки немає')).toBeVisible();
  });

  it('translates interface copy without changing the customer message', () => {
    render(<I18nProvider locale="en" authenticated><ConversationList conversations={[fixtureSummary]} /></I18nProvider>);
    expect(screen.getByRole('navigation', { name: 'Conversation list' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Олена profile photo' })).toBeInTheDocument();
    expect(screen.getAllByText('Хочу чорну модель 38 розміру').at(-1)).toBeVisible();
  });
});
