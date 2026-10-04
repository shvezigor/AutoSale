import type { ConversationDetailResponse } from '../../../../packages/contracts/src/conversations';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
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

function renderComposer(initialConversation = conversation, canManageSettings = false, locale: 'uk' | 'en' = 'uk') {
  return render(
    <I18nProvider locale={locale} authenticated>
      <ToastProvider>
        <SocialReplyComposer canManageSettings={canManageSettings} initialConversation={initialConversation} />
      </ToastProvider>
    </I18nProvider>,
  );
}

describe('SocialReplyComposer', () => {
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
