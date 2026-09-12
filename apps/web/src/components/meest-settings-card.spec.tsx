import { cleanup, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mutatingFetch } = vi.hoisted(() => ({ mutatingFetch: vi.fn() }));
vi.mock('../auth/csrf-fetch', () => ({ mutatingFetch }));

import { ActivityProvider } from './activity-provider';
import { ConfirmProvider } from './confirm-provider';
import { MeestSettingsCard, type MeestSettingsSummary } from './meest-settings-card';
import { ToastProvider } from './toast-provider';

function render(ui: React.ReactElement) {
  return rtlRender(<ToastProvider><ActivityProvider><ConfirmProvider>{ui}</ConfirmProvider></ActivityProvider></ToastProvider>);
}

const disconnected: MeestSettingsSummary = { enabled: true, connection: null };
const active: MeestSettingsSummary = {
  enabled: true,
  connection: { provider: 'MEEST', status: 'ACTIVE', accountLabel: 'merchant', lastVerifiedAt: '2026-09-12T08:00:00.000Z', lastErrorCode: null, senderProfile: null },
};

afterEach(() => {
  cleanup();
  mutatingFetch.mockReset();
});

describe('MeestSettingsCard', () => {
  it('shows only safe connection state to managers', () => {
    render(<MeestSettingsCard initial={active} role="MANAGER" />);
    expect(screen.getByText('merchant')).toBeInTheDocument();
    expect(screen.getByText('Активне')).toBeInTheDocument();
    expect(screen.queryByLabelText('Пароль Meest API')).not.toBeInTheDocument();
  });

  it('connects an owner and removes submitted secrets from the form', async () => {
    mutatingFetch.mockResolvedValue(new Response(JSON.stringify(active.connection), { status: 200 }));
    render(<MeestSettingsCard initial={disconnected} role="OWNER" />);
    fireEvent.change(screen.getByLabelText('Логін Meest API'), { target: { value: 'merchant' } });
    fireEvent.change(screen.getByLabelText('Пароль Meest API'), { target: { value: 'secret-password' } });
    fireEvent.change(screen.getByLabelText('ClientUID'), { target: { value: '8458f0b0-930f-11e2-a91e-003048d2b473' } });
    fireEvent.click(screen.getByRole('button', { name: 'Підключити Meest' }));

    await waitFor(() => expect(mutatingFetch).toHaveBeenCalledWith('/api/integrations/delivery/meest', expect.objectContaining({ method: 'PUT' })));
    expect(JSON.parse(String(mutatingFetch.mock.calls[0]?.[1]?.body))).toEqual({
      login: 'merchant', password: 'secret-password', clientUid: '8458f0b0-930f-11e2-a91e-003048d2b473',
    });
    await waitFor(() => expect(screen.getByLabelText('Пароль Meest API')).toHaveValue(''));
    expect(screen.queryByDisplayValue('secret-password')).not.toBeInTheDocument();
  });
});
