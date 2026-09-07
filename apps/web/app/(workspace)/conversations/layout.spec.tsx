import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getConversations } from '../../../src/api/conversations';
import ConversationsLayout from './layout';

vi.mock('../../../src/api/conversations', () => ({ getConversations: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/conversations/customer-1' }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ConversationsLayout', () => {
  it('keeps the conversation list outside the changing chat content', async () => {
    vi.mocked(getConversations).mockResolvedValue({ items: [], nextCursor: null });

    render(await ConversationsLayout({ children: <div>Поточний чат</div> }));

    expect(getConversations).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'Діалоги' })).toBeInTheDocument();
    expect(screen.getByText('Поточний чат')).toBeInTheDocument();
  });
});
