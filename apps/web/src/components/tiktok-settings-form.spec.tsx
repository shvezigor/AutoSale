import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TikTokConnectionSummary } from '../../../../packages/contracts/src/tiktok';
import { TikTokSettingsForm } from './tiktok-settings-form';

const disconnected: TikTokConnectionSummary = {
  status: 'NOT_CONNECTED', platformAvailability: 'AVAILABLE', accountId: null, displayName: null, capabilities: null,
  tokenExpiresAt: null, lastVerifiedAt: null, lastErrorCode: null, cleanupStatus: 'NONE',
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TikTokSettingsForm', () => {
  it('preserves an active connection and cleanup controls while the platform is paused', () => {
    render(<TikTokSettingsForm initial={{
      ...disconnected,
      status: 'ACTIVE',
      platformAvailability: 'ADMIN_DISABLED',
      accountId: 'fictional-account',
      displayName: 'Fictional TikTok Shop',
      capabilities: { receiveMessages: true, sendText: true, sendImage: false },
      cleanupStatus: 'FAILED',
    }} membershipRole="OWNER" embedded />);

    expect(screen.getByText('Fictional TikTok Shop')).toBeVisible();
    expect(screen.getByText(/тимчасово призупинено адміністратором Sales AITO/i)).toBeVisible();
    expect(screen.queryByRole('button', { name: /підключити TikTok/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Відключити TikTok' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Повторити очищення' })).toBeVisible();
    expect(document.body.textContent).not.toMatch(/environment|credential|secret/i);
  });

  it('shows deployment unavailability without an activation action for a manager', () => {
    render(<TikTokSettingsForm initial={{ ...disconnected, platformAvailability: 'DEPLOYMENT_UNAVAILABLE' }} membershipRole="MANAGER" embedded />);

    expect(screen.getByText(/TikTok ще не доступний/i)).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('starts trusted OAuth with the shared primary action', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'fictional-csrf' }) })
      .mockImplementationOnce(() => new Promise(() => undefined)));
    render(<TikTokSettingsForm initial={disconnected} membershipRole="OWNER" embedded />);
    const button = screen.getByRole('button', { name: 'Підключити TikTok' });
    expect(button).toHaveClass('primary-button');
    fireEvent.click(button);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/integrations/tiktok/authorize', expect.objectContaining({ method: 'POST' })));
  });

  it('shows inbound-only capability and hides mutations from a manager', () => {
    render(<TikTokSettingsForm initial={{
      ...disconnected, status: 'INBOUND_ONLY', accountId: 'fictional-account', displayName: 'Fictional Shop',
      capabilities: { receiveMessages: true, sendText: false, sendImage: false },
    }} membershipRole="MANAGER" embedded />);
    expect(screen.getByText('Лише отримання повідомлень')).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
