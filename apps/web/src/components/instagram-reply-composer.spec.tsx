import type { ConversationDetailResponse } from '../../../../packages/contracts/src/conversations';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  refreshConversation: vi.fn(),
  retryConversationMessage: vi.fn(),
  sendConversationMessage: vi.fn(),
}));
vi.mock('../api/conversation-replies', () => api);

import { InstagramReplyComposer } from './instagram-reply-composer';
import { ToastProvider } from './toast-provider';

const message = {
  id: '22222222-2222-4222-8222-222222222222',
  direction: 'OUTBOUND' as const,
  senderId: 'instagram-shop',
  text: 'Вітаю',
  sourceTimestamp: '2026-09-07T12:00:00.000Z',
  attachments: [],
  delivery: { status: 'PENDING' as const, attempts: 0, errorCode: null, retryAllowed: false },
};
const conversation: ConversationDetailResponse = {
  id: '11111111-1111-4111-8111-111111111111',
  channel: 'INSTAGRAM',
  participantName: 'Олена',
  participantUsername: 'olena',
  participantAvatarUrl: null,
  replyCapability: { enabled: true, reason: null },
  messages: [],
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.values(api).forEach((mock) => mock.mockReset());
});

function renderComposer(initialConversation = conversation, canManageSettings = false) {
  return render(<ToastProvider><InstagramReplyComposer
    canManageSettings={canManageSettings}
    initialConversation={initialConversation}
  /></ToastProvider>);
}

describe('InstagramReplyComposer', () => {
  it('submits trimmed text with one UUID and renders the pending message', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => '44444444-4444-4444-8444-444444444444' });
    api.sendConversationMessage.mockResolvedValue(message);
    api.refreshConversation.mockResolvedValue({ ...conversation, messages: [message] });
    renderComposer();

    fireEvent.change(screen.getByRole('textbox', { name: 'Відповідь' }), { target: { value: '  Вітаю  ' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Відповідь' }), { key: 'Enter' });

    await waitFor(() => expect(api.sendConversationMessage).toHaveBeenCalledWith(conversation.id, {
      text: 'Вітаю', idempotencyKey: '44444444-4444-4444-8444-444444444444',
    }));
    expect(await screen.findByText('Надсилається…')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Відповідь' })).toHaveFocus();
  });

  it('keeps Shift+Enter as a newline and blocks blank or oversized content', () => {
    renderComposer();
    const field = screen.getByRole('textbox', { name: 'Відповідь' });
    fireEvent.change(field, { target: { value: ' ' } });
    expect(screen.getByRole('button', { name: 'Надіслати' })).toBeDisabled();
    fireEvent.change(field, { target: { value: 'x'.repeat(1_001) } });
    expect(screen.getByRole('button', { name: 'Надіслати' })).toBeDisabled();
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });
    expect(api.sendConversationMessage).not.toHaveBeenCalled();
  });

  it('updates the same failed bubble on a safe retry', async () => {
    const failed = { ...message, delivery: { status: 'FAILED' as const, attempts: 5, errorCode: 'INSTAGRAM_RATE_LIMITED' as const, retryAllowed: true } };
    api.retryConversationMessage.mockResolvedValue(message);
    renderComposer({ ...conversation, messages: [failed] });

    fireEvent.click(screen.getByRole('button', { name: 'Повторити надсилання' }));

    await waitFor(() => expect(api.retryConversationMessage).toHaveBeenCalledWith(conversation.id, failed.id));
    expect(screen.getAllByText('Вітаю')).toHaveLength(1);
    expect(screen.getByText('Надсилається…')).toBeVisible();
  });

  it('keeps polling an unknown delivery until a late sent confirmation arrives', async () => {
    vi.useFakeTimers();
    const unknown = {
      ...message,
      delivery: {
        status: 'UNKNOWN' as const,
        attempts: 1,
        errorCode: 'INSTAGRAM_DELIVERY_UNKNOWN' as const,
        retryAllowed: false,
      },
    };
    const sent = {
      ...message,
      delivery: { status: 'SENT' as const, attempts: 1, errorCode: null, retryAllowed: false },
    };
    api.refreshConversation
      .mockResolvedValueOnce({ ...conversation, messages: [unknown] })
      .mockResolvedValueOnce({ ...conversation, messages: [sent] });
    renderComposer({ ...conversation, messages: [message] });

    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(screen.getByText('Статус доставки невідомий')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Повторити надсилання' })).not.toBeInTheDocument();

    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(screen.getByText('Надіслано')).toBeVisible();
    await act(async () => vi.advanceTimersByTimeAsync(4_000));
    expect(api.refreshConversation).toHaveBeenCalledTimes(4);
  });

  it('shows a new inbound message without reloading or switching conversations', async () => {
    vi.useFakeTimers();
    const inbound = {
      id: '55555555-5555-4555-8555-555555555555',
      direction: 'INBOUND' as const,
      senderId: 'instagram-customer',
      text: 'Моя адреса — Луцьк',
      sourceTimestamp: '2026-09-07T12:01:00.000Z',
      attachments: [],
      delivery: null,
    };
    api.refreshConversation.mockResolvedValue({ ...conversation, messages: [inbound] });
    renderComposer();

    await act(async () => vi.advanceTimersByTimeAsync(2_000));

    expect(screen.getByText('Моя адреса — Луцьк')).toBeVisible();
  });

  it('shows connection guidance and disables replies', () => {
    renderComposer({
      ...conversation,
      replyCapability: { enabled: false, reason: 'RECONNECT_REQUIRED' },
    }, true);
    expect(screen.getByRole('textbox', { name: 'Відповідь' })).toBeDisabled();
    expect(screen.getByRole('link', { name: /Instagram/i })).toHaveAttribute('href', '/settings?tab=social');
  });

  it('tells a manager to contact the owner without exposing owner settings action', () => {
    renderComposer({
      ...conversation,
      replyCapability: { enabled: false, reason: 'NOT_CONNECTED' },
    });
    expect(screen.getByText(/спочатку підключіть Instagram/i)).toBeVisible();
    expect(screen.queryByRole('link', { name: /Instagram/i })).not.toBeInTheDocument();
  });
});
