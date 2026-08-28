import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  InstagramSettingsForm,
  isTrustedMetaAuthorizationUrl,
  type InstagramConnectionSummary,
} from './instagram-settings-form';

const initial = (overrides: Partial<InstagramConnectionSummary> = {}): InstagramConnectionSummary => ({
  status: 'NOT_CONNECTED',
  accountId: null,
  username: null,
  tokenExpiresAt: null,
  lastVerifiedAt: null,
  lastErrorCode: null,
  ...overrides,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('InstagramSettingsForm', () => {
  it('offers an owner a connection button when Instagram is not connected', () => {
    render(<InstagramSettingsForm initial={initial()} membershipRole="OWNER" />);

    expect(screen.getByRole('button', { name: 'Підключити Instagram' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Instagram Account ID')).not.toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByText('Instagram відключено')).toBeInTheDocument());
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

    fireEvent.click(screen.getByRole('button', { name: 'Підключити Instagram' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Не вдалося розпочати підключення Instagram');
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
