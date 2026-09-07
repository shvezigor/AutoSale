import type { ConversationListResponse } from '../../../../packages/contracts/src/conversations';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ refreshConversationList: vi.fn() }));
vi.mock('../api/conversation-replies', () => api);

import { LiveConversationList } from './live-conversation-list';

const initial: ConversationListResponse['items'] = [{
  id: '11111111-1111-4111-8111-111111111111',
  channel: 'INSTAGRAM', participantName: 'Олена', participantUsername: 'olena',
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
    render(<LiveConversationList conversations={initial} selectedId={initial[0]!.id} />);

    await act(async () => vi.advanceTimersByTimeAsync(3_000));

    expect(screen.getByText('Нове повідомлення')).toBeVisible();
    expect(screen.getByText('Усього діалогів: 1')).toBeVisible();
  });
});
