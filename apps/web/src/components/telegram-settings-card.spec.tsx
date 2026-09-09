import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActivityProvider } from './activity-provider';
import { TelegramSettingsCard, type TelegramConnectionSummary } from './telegram-settings-card';
import { ToastProvider } from './toast-provider';

function renderCard(initial: TelegramConnectionSummary, navigate = vi.fn()) {
  return {
    navigate,
    ...render(<ToastProvider><ActivityProvider><TelegramSettingsCard initial={initial} navigate={navigate} /></ActivityProvider></ToastProvider>),
  };
}

const disconnected: TelegramConnectionSummary = {
  available: true,
  botUsername: 'AutoSaleBot',
  personal: { connected: false, displayName: null, username: null, linkedAt: null },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TelegramSettingsCard', () => {
  it('explains the one-click shared bot connection without asking for a token', () => {
    renderCard(disconnected);

    expect(screen.getByText(/бот AutoSale вже налаштований/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Підключити Telegram' })).toBeInTheDocument();
    expect(screen.queryByText(/BotFather/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('creates a private link with CSRF protection and opens Telegram', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf-token' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ url: 'https://t.me/AutoSaleBot?start=safe_token', expiresAt: '2026-09-09T12:05:00.000Z' }) });
    vi.stubGlobal('fetch', fetchMock);
    const { navigate } = renderCard(disconnected);

    fireEvent.click(screen.getByRole('button', { name: 'Підключити Telegram' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('https://t.me/AutoSaleBot?start=safe_token'));
    expect(fetchMock).toHaveBeenLastCalledWith('/api/integrations/telegram/link', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ purpose: 'PERSONAL', returnPath: '/settings?tab=telegram' }),
      headers: expect.objectContaining({ 'x-csrf-token': 'csrf-token' }),
    }));
  });

  it('sends a test alert and keeps the action visibly pending', async () => {
    let resolveRequest!: (value: Response) => void;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf-token' }) })
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveRequest = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    renderCard({
      ...disconnected,
      personal: { connected: true, displayName: 'Ihor Shvets', username: 'shvezigor', linkedAt: '2026-09-09T12:00:00.000Z' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Надіслати тест' }));

    await waitFor(() => expect(screen.getByRole('button', { name: /Надсилаємо/ })).toBeDisabled());
    expect(screen.getByRole('progressbar', { name: 'Надсилаємо тестове сповіщення' })).toBeInTheDocument();
    resolveRequest(new Response(JSON.stringify({ deliveryId: 'delivery-id', status: 'PENDING' }), { status: 201 }));
    await waitFor(() => expect(screen.getAllByText('Тестове сповіщення поставлено в чергу').length).toBeGreaterThan(0));
  });

  it('unlinks only after confirmation and updates the card', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf-token' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ disconnected: true }) });
    vi.stubGlobal('fetch', fetchMock);
    renderCard({
      ...disconnected,
      personal: { connected: true, displayName: 'Ihor Shvets', username: 'shvezigor', linkedAt: '2026-09-09T12:00:00.000Z' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Відключити' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Відключити Telegram?');
    fireEvent.click(screen.getByRole('button', { name: 'Так, відключити' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Підключити Telegram' })).toBeInTheDocument());
  });
});
