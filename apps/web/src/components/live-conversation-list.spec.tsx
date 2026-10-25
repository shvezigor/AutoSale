import type { ConversationListResponse } from '../../../../packages/contracts/src/conversations';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ refreshConversationList: vi.fn(), refreshConversationStatusCounts: vi.fn() }));
const navigation = vi.hoisted(() => ({ pathname: '/conversations/11111111-1111-4111-8111-111111111111' }));
vi.mock('../api/conversation-replies', () => api);
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname, useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh: vi.fn() }) }));

import { ConversationTriageProvider } from './conversation-triage-context';
import { LiveConversationList } from './live-conversation-list';

const initial: ConversationListResponse['items'] = [{
  id: '11111111-1111-4111-8111-111111111111',
  workflowStatus: 'ACTIVE', statusVersion: 0, channel: 'INSTAGRAM', participantName: 'Олена', participantUsername: 'olena',
  participantAvatarUrl: null, lastMessagePreview: 'Старе повідомлення',
  lastMessageAt: '2026-09-07T12:00:00.000Z',
}];

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  api.refreshConversationList.mockReset();
});

describe('LiveConversationList', () => {
  it('refreshes previews and ordering without a page reload', async () => {
    vi.useFakeTimers();
    api.refreshConversationList.mockResolvedValue({
      items: [{ ...initial[0], lastMessagePreview: 'Нове повідомлення' }], nextCursor: null,
    });
    render(<ConversationTriageProvider initialPage={{ items: initial, nextCursor: null }} initialCounts={{ ACTIVE: 81, INACTIVE: 0, CLOSED: 0 }}><LiveConversationList /></ConversationTriageProvider>);

    expect(screen.getByRole('link', { name: /Олена/ })).toHaveAttribute('data-selected', 'true');

    await act(async () => vi.advanceTimersByTimeAsync(3_000));

    expect(screen.getByText('Нове повідомлення')).toBeVisible();
    expect(screen.getByText('Усього діалогів: 81')).toBeVisible();
  });
});
