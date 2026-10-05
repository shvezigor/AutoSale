import type { ConversationDetailResponse } from '../../../../packages/contracts/src/conversations';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  createConversationReplyDraft: vi.fn(),
  refreshConversation: vi.fn(),
  retryConversationMessage: vi.fn(),
  sendConversationMessage: vi.fn(),
}));
vi.mock('../api/conversation-replies', () => api);
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { I18nProvider } from '../i18n/i18n-provider';
import { SocialReplyComposer } from './social-reply-composer';
import { ToastProvider } from './toast-provider';

const conversation: ConversationDetailResponse = {
  id: '11111111-1111-4111-8111-111111111111',
  channel: 'TIKTOK',
  participantName: 'Fictional TikTok Customer',
  participantUsername: 'fictional.customer',
  participantAvatarUrl: null,
  replyCapability: { enabled: true, reason: null },
  messages: [],
};

const pendingMessage = {
  id: '22222222-2222-4222-8222-222222222222',
  direction: 'OUTBOUND' as const,
  senderId: 'fictional-business',
  text: 'Ваше замовлення прийнято.',
  sourceTimestamp: '2026-10-04T09:00:00.000Z',
  attachments: [],
  delivery: { status: 'PENDING' as const, attempts: 0, errorCode: null, retryAllowed: false },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.values(api).forEach((mock) => mock.mockReset());
});

function renderComposer(initialConversation = conversation, canManageSettings = false, locale: 'uk' | 'en' = 'uk', draftsEnabled = false) {
  return render(
    <I18nProvider locale={locale} authenticated>
      <ToastProvider>
        <SocialReplyComposer canManageSettings={canManageSettings} initialConversation={initialConversation} draftsEnabled={draftsEnabled} />
      </ToastProvider>
    </I18nProvider>,
  );
}

describe('SocialReplyComposer', () => {
  it('generates a draft, applies it without sending, and links it on explicit send', async () => {
    const inbound = { ...pendingMessage, id: '33333333-3333-4333-8333-333333333333',
      direction: 'INBOUND' as const, text: 'Чи є товар?', delivery: null };
    const draft = {
      id: '55555555-5555-4555-8555-555555555555', conversationId: conversation.id,
      anchorMessageId: inbound.id, status: 'READY' as const, outcome: 'CLARIFY' as const,
      generatedText: 'Який товар вас цікавить?', finalText: null, sources: [], errorCode: null,
      createdAt: '2026-10-05T10:00:00.000Z', updatedAt: '2026-10-05T10:00:00.000Z',
    };
    api.createConversationReplyDraft.mockResolvedValue(draft);
    api.sendConversationMessage.mockResolvedValue(pendingMessage);
    api.refreshConversation.mockResolvedValue({ ...conversation, messages: [inbound], replyDrafts: [draft] });
    renderComposer({ ...conversation, messages: [inbound] }, false, 'uk', true);

    fireEvent.click(screen.getByRole('button', { name: 'Створити чернетку' }));
    expect(await screen.findByText('Який товар вас цікавить?')).toBeVisible();
    expect(api.sendConversationMessage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Вставити в редактор' }));
    expect(screen.getByRole('textbox', { name: 'Відповідь' })).toHaveValue('Який товар вас цікавить?');
    fireEvent.click(screen.getByRole('button', { name: 'Надіслати' }));
    await waitFor(() => expect(api.sendConversationMessage).toHaveBeenCalledWith(conversation.id,
      expect.objectContaining({ text: 'Який товар вас цікавить?', draftId: draft.id })));
  });

  it('offers copy-only draft handling for Facebook without an API send', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    renderComposer({ ...conversation, channel: 'FACEBOOK',
      replyCapability: { enabled: false, reason: 'CHANNEL_READ_ONLY' } }, false, 'en', true);
    fireEvent.change(screen.getByRole('textbox', { name: 'Reply' }), { target: { value: 'Hello there' } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy text' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Hello there'));
    expect(api.sendConversationMessage).not.toHaveBeenCalled();
  });

  it('sends a TikTok reply and reuses the same idempotency key after an uncertain browser failure', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => '44444444-4444-4444-8444-444444444444' });
    api.sendConversationMessage
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce(pendingMessage);
    api.refreshConversation.mockResolvedValue({ ...conversation, messages: [pendingMessage] });
    renderComposer();

    fireEvent.change(screen.getByRole('textbox', { name: 'Відповідь' }), {
      target: { value: 'Ваше замовлення прийнято.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Надіслати' }));
    await screen.findByText('Спробуйте ще раз. Текст повідомлення збережено.');
    expect(screen.getByRole('textbox', { name: 'Відповідь' })).toHaveValue('Ваше замовлення прийнято.');

    fireEvent.click(screen.getByRole('button', { name: 'Надіслати' }));
    await waitFor(() => expect(api.sendConversationMessage).toHaveBeenCalledTimes(2));
    expect(api.sendConversationMessage).toHaveBeenNthCalledWith(1, conversation.id, {
      text: 'Ваше замовлення прийнято.', idempotencyKey: '44444444-4444-4444-8444-444444444444',
    });
    expect(api.sendConversationMessage).toHaveBeenNthCalledWith(2, conversation.id, {
      text: 'Ваше замовлення прийнято.', idempotencyKey: '44444444-4444-4444-8444-444444444444',
    });
    expect(await screen.findByText('Надсилається…', { selector: '.delivery-status' })).toBeVisible();
  });

  it('explains unavailable TikTok sending and links owners to channel settings', () => {
    renderComposer({
      ...conversation,
      replyCapability: { enabled: false, reason: 'TIKTOK_CAPABILITY_UNAVAILABLE' },
    }, true);

    expect(screen.getByRole('textbox', { name: 'Відповідь' })).toBeDisabled();
    expect(screen.getByText(/дозвіл на надсилання відповідей TikTok/i)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Налаштувати TikTok' })).toHaveAttribute('href', '/settings?tab=social');
  });

  it('shows reconnect and reply-window guidance in English', () => {
    const { rerender } = renderComposer({
      ...conversation,
      replyCapability: { enabled: false, reason: 'RECONNECT_REQUIRED' },
    }, false, 'en');
    expect(screen.getByText(/reconnect TikTok/i)).toBeVisible();

    rerender(
      <I18nProvider locale="en" authenticated>
        <ToastProvider>
          <SocialReplyComposer
            canManageSettings={false}
            initialConversation={{
              ...conversation,
              replyCapability: { enabled: false, reason: 'TIKTOK_REPLY_NOT_PERMITTED' },
            }}
          />
        </ToastProvider>
      </I18nProvider>,
    );
    expect(screen.getByText(/48-hour TikTok reply window/i)).toBeVisible();
  });
});
