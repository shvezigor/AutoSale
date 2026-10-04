import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TikTokConnectionSummary } from '../../../../packages/contracts/src/tiktok';
import { TikTokSettingsForm } from './tiktok-settings-form';

const disconnected: TikTokConnectionSummary = {
  status: 'NOT_CONNECTED', accountId: null, displayName: null, capabilities: null,
  tokenExpiresAt: null, lastVerifiedAt: null, lastErrorCode: null, cleanupStatus: 'NONE',
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TikTokSettingsForm', () => {
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
