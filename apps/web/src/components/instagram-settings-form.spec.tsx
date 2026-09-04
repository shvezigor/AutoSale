import { cleanup, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  InstagramSettingsForm,
  isTrustedMetaAuthorizationUrl,
  type InstagramConnectionSummary,
} from './instagram-settings-form';
import { ActivityProvider } from './activity-provider';
import { ToastProvider } from './toast-provider';

function render(ui: React.ReactElement) { return rtlRender(<ToastProvider><ActivityProvider>{ui}</ActivityProvider></ToastProvider>); }

const initial = (overrides: Partial<InstagramConnectionSummary> = {}): InstagramConnectionSummary => ({
  status: 'NOT_CONNECTED',
  accountId: null,
  username: null,
  tokenExpiresAt: null,
  lastVerifiedAt: null,
  lastErrorCode: null,
  cleanupStatus: 'NONE',
  cleanupErrorCode: null,
  cleanupAbandonEligible: false,
  ...overrides,
});

function startMetaAuthorization() {
  fireEvent.click(screen.getByRole('button', { name: 'Підключити Instagram' }));
  fireEvent.click(screen.getByRole('button', { name: 'Продовжити' }));
  fireEvent.click(screen.getByRole('button', { name: 'Підключити через Meta' }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('InstagramSettingsForm', () => {
  it('guides an owner through preparation before starting Meta authorization', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<InstagramSettingsForm initial={initial()} membershipRole="OWNER" />);

    expect(screen.getByRole('button', { name: 'Підключити Instagram' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Підключення Instagram' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Підключити Instagram' }));

    expect(screen.getByRole('dialog', { name: 'Підключення Instagram' })).toBeInTheDocument();
    expect(screen.getByText('Професійний акаунт')).toBeInTheDocument();
    expect(screen.getByText('Безпечний вхід через Meta')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Продовжити' }));

    expect(screen.getByText('Дозволи та вибір акаунта')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Підключити через Meta' })).toBeInTheDocument();
  });

  it('shows the connected username and most recent verification for an active connection', () => {
    render(
      <InstagramSettingsForm
        initial={initial({
          status: 'ACTIVE',
          username: 'autosale_store',
          lastVerifiedAt: '2026-08-28T12:00:00.000Z',
        })}
        membershipRole="OWNER"
      />,
    );

    expect(screen.getByText('@autosale_store')).toBeInTheDocument();
    expect(screen.getByText(/28.*2026/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Відключити Instagram' })).toBeInTheDocument();
  });

  it('offers reconnection when authorization is required', () => {
    render(<InstagramSettingsForm initial={initial({ status: 'REAUTH_REQUIRED' })} membershipRole="OWNER" />);

    expect(screen.getByRole('button', { name: 'Перепідключити Instagram' })).toBeInTheDocument();
  });

  it('shows and announces the connecting state while the owner request is in flight', async () => {
    let resolveConnect!: (value: unknown) => void;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf-token' }) })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveConnect = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    render(<InstagramSettingsForm initial={initial()} membershipRole="OWNER" />);

    startMetaAuthorization();

    await waitFor(() => expect(screen.getByRole('region', { name: 'Instagram' })).toHaveAttribute('aria-busy', 'true'));
    expect(screen.getByRole('status')).toHaveTextContent('Підключення…');
    resolveConnect({ ok: false, json: async () => null });
  });

  it('offers a reachable cleanup retry instead of connect while a credential is retained', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf-token' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => initial({ status: 'DISCONNECTED' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<InstagramSettingsForm initial={initial({
      status: 'DISCONNECTED',
      cleanupStatus: 'FAILED',
      cleanupErrorCode: 'META_DISCONNECT_CLEANUP_FAILED',
    })} membershipRole="OWNER" />);

    expect(screen.queryByRole('button', { name: 'Підключити Instagram' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Повторити очищення' }));

    await waitFor(() => expect(screen.getAllByText('Очищення Instagram завершено').length).toBeGreaterThan(0));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/integrations/instagram/cleanup',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-csrf-token': 'csrf-token' }),
      }),
    );
  });

  it('keeps cleanup retry reachable when the provider cleanup fails again', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf-token' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => initial({
          status: 'DISCONNECTED',
          cleanupStatus: 'FAILED',
          cleanupErrorCode: 'META_DISCONNECT_CLEANUP_FAILED',
        }),
      });
    vi.stubGlobal('fetch', fetchMock);
    render(<InstagramSettingsForm initial={initial({
      status: 'DISCONNECTED',
      cleanupStatus: 'FAILED',
      cleanupErrorCode: 'META_DISCONNECT_CLEANUP_FAILED',
    })} membershipRole="OWNER" />);

    fireEvent.click(screen.getByRole('button', { name: 'Повторити очищення' }));

    expect((await screen.findAllByRole('alert')).some((element) => element.textContent?.includes('Не вдалося очистити підключення Instagram'))).toBe(true);
    expect(screen.getByRole('button', { name: 'Повторити очищення' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Підключити Instagram' })).not.toBeInTheDocument();
  });

  it('requires an explicit owner confirmation before dead-lettering permanent cleanup failure', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf-token' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => initial({
          status: 'DISCONNECTED',
          cleanupStatus: 'NONE',
          cleanupErrorCode: null,
          lastErrorCode: 'META_CLEANUP_DEAD_LETTERED',
        }),
      });
    vi.stubGlobal('fetch', fetchMock);
    render(<InstagramSettingsForm initial={initial({
      status: 'DISCONNECTED',
      cleanupStatus: 'FAILED',
      cleanupErrorCode: 'META_CLEANUP_PERMANENT_FAILURE',
    })} membershipRole="OWNER" />);

    fireEvent.click(screen.getByRole('button', { name: 'Розблокувати підключення' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Розблокувати Instagram?');
    expect(screen.getByRole('alert')).toHaveTextContent('Віддалене очищення не підтверджене');
    expect(screen.getByRole('alert')).toHaveTextContent('Автоматичні повтори для цього облікового запису буде припинено');
    expect(screen.getByRole('alert')).toHaveTextContent('залишковий стан у Meta може зберегтися');
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Так, розблокувати' }));

    await waitFor(() => expect(screen.getByText('Підключення Instagram розблоковано')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/integrations/instagram/cleanup/dead-letter',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ confirmation: 'ABANDON_REMOTE_CLEANUP' }),
        headers: expect.objectContaining({ 'x-csrf-token': 'csrf-token' }),
      }),
    );
    expect(screen.getByRole('button', { name: 'Підключити Instagram' })).toBeInTheDocument();
  });

  it('offers the same confirmed abandon flow after a retryable cleanup reaches the safe threshold', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf-token' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => initial({
          status: 'DISCONNECTED',
          cleanupStatus: 'NONE',
          cleanupErrorCode: null,
          cleanupAbandonEligible: false,
          lastErrorCode: 'META_CLEANUP_DEAD_LETTERED',
        }),
      });
    vi.stubGlobal('fetch', fetchMock);
    render(<InstagramSettingsForm initial={initial({
      status: 'DISCONNECTED',
      cleanupStatus: 'FAILED',
      cleanupErrorCode: 'META_DISCONNECT_CLEANUP_FAILED',
      cleanupAbandonEligible: true,
    })} membershipRole="OWNER" />);

    expect(screen.getByRole('button', { name: 'Розблокувати підключення' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Розблокувати підключення' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Віддалене очищення не підтверджене');
    fireEvent.click(screen.getByRole('button', { name: 'Так, розблокувати' }));

    await waitFor(() => expect(screen.getByText('Підключення Instagram розблоковано')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/integrations/instagram/cleanup/dead-letter',
      expect.objectContaining({ body: JSON.stringify({ confirmation: 'ABANDON_REMOTE_CLEANUP' }) }),
    );
  });

  it('keeps cleanup retry reachable without downgrading a newer active connection', () => {
    render(<InstagramSettingsForm initial={initial({
      status: 'ACTIVE',
      username: 'new_store',
      cleanupStatus: 'FAILED',
      cleanupErrorCode: 'META_DISCONNECT_CLEANUP_FAILED',
    })} membershipRole="OWNER" />);

    expect(screen.getByText('@new_store')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторити очищення' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Відключити Instagram' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Підключити Instagram' })).not.toBeInTheDocument();
  });

  it('keeps connection metadata read-only for a manager', () => {
    render(<InstagramSettingsForm initial={initial({ status: 'ACTIVE', username: 'autosale_store' })} membershipRole="MANAGER" />);

    expect(screen.getByText('@autosale_store')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Instagram/ })).not.toBeInTheDocument();
  });

  it('asks an owner to explicitly confirm disconnecting before mutating the connection', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf-token' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => initial({ status: 'DISCONNECTED' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<InstagramSettingsForm initial={initial({ status: 'ACTIVE' })} membershipRole="OWNER" />);

    fireEvent.click(screen.getByRole('button', { name: 'Відключити Instagram' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Відключити Instagram?');
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Так, відключити' }));
    await waitFor(() => expect(screen.getAllByText('Instagram відключено').length).toBeGreaterThan(0));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/integrations/instagram/disconnect',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-csrf-token': 'csrf-token' }),
      }),
    );
  });

  it('shows a generic safe error when connect returns malformed data', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf-token' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => undefined });
    vi.stubGlobal('fetch', fetchMock);
    render(<InstagramSettingsForm initial={initial()} membershipRole="OWNER" />);

    startMetaAuthorization();

    expect((await screen.findAllByRole('alert')).some((element) => element.textContent?.includes('Не вдалося розпочати підключення Instagram'))).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/integrations/instagram/connect',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ returnPath: '/settings' }),
        headers: expect.objectContaining({ 'x-csrf-token': 'csrf-token' }),
      }),
    );
  });

  it('accepts only the configured Meta authorization origin', () => {
    expect(isTrustedMetaAuthorizationUrl('https://www.instagram.com/oauth/authorize?state=opaque')).toBe(true);
    expect(isTrustedMetaAuthorizationUrl('https://attacker.example/oauth/authorize')).toBe(false);
    expect(isTrustedMetaAuthorizationUrl('http://www.instagram.com/oauth/authorize')).toBe(false);
  });
});
