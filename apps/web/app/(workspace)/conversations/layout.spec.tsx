import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getConversations, getConversationStatusCounts } from '../../../src/api/conversations';
import ConversationsLayout from './layout';

vi.mock('../../../src/api/conversations', () => ({ getConversations: vi.fn(), getConversationStatusCounts: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/conversations/customer-1',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ConversationsLayout', () => {
  it('keeps the conversation list outside the changing chat content', async () => {
    vi.mocked(getConversations).mockResolvedValue({ items: [], nextCursor: null });
    vi.mocked(getConversationStatusCounts).mockResolvedValue({ ACTIVE: 0, INACTIVE: 3, CLOSED: 2 });

    render(await ConversationsLayout({ children: <div>Поточний чат</div> }));

    expect(getConversations).toHaveBeenCalledTimes(1);
    expect(getConversations).toHaveBeenCalledWith({ status: 'ACTIVE' });
    expect(getConversationStatusCounts).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('tab', { name: 'Неактивні 3' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Діалоги' })).toBeInTheDocument();
    expect(screen.getByText('Поточний чат')).toBeInTheDocument();
  });
});
