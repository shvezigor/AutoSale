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
const configured: MeestSettingsSummary = {
  enabled: true,
  connection: {
    ...active.connection!,
    senderProfile: {
      senderName: 'ТОВ Приклад', senderPhone: '+380501112233',
      origin: { type: 'BRANCH', cityRef: 'city-ref', locationRef: 'branch-ref', label: 'Відділення Meest №1' },
      payer: 'SENDER', defaultParcel: { weightKg: 1, lengthCm: 30, widthCm: 20, heightCm: 10 },
      suggestCustomerNotification: true, customerNotificationTemplate: '{company}: ТТН {trackingNumber}',
    },
  },
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

  it('lets an owner choose an exact Meest origin and save sender defaults', async () => {
    render(<MeestSettingsCard initial={active} role="OWNER" />);
    expect(screen.getByLabelText('Назва відправника Meest')).toBeInTheDocument();
    expect(screen.getByLabelText('Телефон відправника Meest')).toBeInTheDocument();
    expect(screen.getByLabelText('Місто відправлення Meest')).toBeInTheDocument();
    expect(screen.getByLabelText('Відділення відправлення Meest')).toBeInTheDocument();
  });

  it('saves a complete sender profile without exposing connection credentials', async () => {
    mutatingFetch.mockResolvedValue(new Response(JSON.stringify(configured.connection!.senderProfile), { status: 200 }));
    render(<MeestSettingsCard initial={configured} role="OWNER" />);
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти відправника' }));

    await waitFor(() => expect(mutatingFetch).toHaveBeenCalledWith(
      '/api/integrations/delivery/meest/sender-profile',
      expect.objectContaining({ method: 'PUT' }),
    ));
    const body = JSON.parse(String(mutatingFetch.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({ senderName: 'ТОВ Приклад', origin: { locationRef: 'branch-ref' } });
    expect(body).not.toHaveProperty('password');
    expect(body).not.toHaveProperty('clientUid');
  });
});
