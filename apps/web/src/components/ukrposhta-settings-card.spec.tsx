import { cleanup, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mutatingFetch } = vi.hoisted(() => ({ mutatingFetch: vi.fn() }));
vi.mock('../auth/csrf-fetch', () => ({ mutatingFetch }));

import { ActivityProvider } from './activity-provider';
import { ConfirmProvider } from './confirm-provider';
import { ToastProvider } from './toast-provider';
import { UkrposhtaSettingsCard, type UkrposhtaSettingsSummary } from './ukrposhta-settings-card';

function render(ui: React.ReactElement) {
  return rtlRender(<ToastProvider><ActivityProvider><ConfirmProvider>{ui}</ConfirmProvider></ActivityProvider></ToastProvider>);
}

const disconnected: UkrposhtaSettingsSummary = { enabled: true, connection: null };
const active: UkrposhtaSettingsSummary = {
  enabled: true,
  connection: {
    provider: 'UKRPOSHTA', status: 'ACTIVE', accountLabel: 'ТОВ Приклад · тестове середовище',
    lastVerifiedAt: '2026-09-12T08:00:00.000Z', lastErrorCode: null, environment: 'SANDBOX', senderProfile: null,
  },
};
const configured: UkrposhtaSettingsSummary = {
  enabled: true,
  connection: {
    ...active.connection!,
    senderProfile: {
      senderName: 'ТОВ Приклад', senderPhone: '+380501112233',
      origin: { type: 'BRANCH', cityRef: '263:297', locationRef: '1', label: '43000 · Луцьк 1' },
      payer: 'SENDER', defaultParcel: { weightKg: 1, lengthCm: 30, widthCm: 20, heightCm: 10 },
      suggestCustomerNotification: true, customerNotificationTemplate: '{company}: ТТН {trackingNumber}',
    },
  },
};

afterEach(() => {
  cleanup();
  mutatingFetch.mockReset();
  vi.unstubAllGlobals();
});

describe('UkrposhtaSettingsCard', () => {
  it('shows managers only the safe connection state', () => {
    render(<UkrposhtaSettingsCard initial={configured} role="MANAGER" />);
    expect(screen.getByText('ТОВ Приклад · тестове середовище')).toBeInTheDocument();
    expect(screen.getByText('Тестове середовище')).toBeInTheDocument();
    expect(screen.getByText('ТОВ Приклад', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('+380501112233')).toBeInTheDocument();
    expect(screen.getByText('43000 · Луцьк 1')).toBeInTheDocument();
    expect(screen.getByText('Відправник', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('1 кг · 30 × 20 × 10 см')).toBeInTheDocument();
    expect(screen.getByText('Так', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('{company}: ТТН {trackingNumber}')).toBeInTheDocument();
    expect(screen.queryByLabelText('eCom bearer')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Назва відправника Укрпошти')).not.toBeInTheDocument();
    expect(screen.queryByText(/Особистому кабінеті/)).not.toBeInTheDocument();
  });

  it('lets an owner choose an exact branch and exposes the complete sender form', () => {
    render(<UkrposhtaSettingsCard initial={active} role="OWNER" />);
    expect(screen.getByLabelText('Назва відправника Укрпошти')).toBeInTheDocument();
    expect(screen.getByLabelText('Телефон відправника Укрпошти')).toBeInTheDocument();
    expect(screen.getByLabelText('Місто відправлення Укрпошти')).toBeInTheDocument();
    expect(screen.getByLabelText('Відділення відправлення Укрпошти')).toBeInTheDocument();
    expect(screen.getByLabelText('Хто оплачує доставку Укрпошти')).toBeInTheDocument();
    expect(screen.getByLabelText('Шаблон повідомлення Укрпошти')).toBeInTheDocument();
  });

  it('saves only the safe complete Ukrposhta sender profile', async () => {
    mutatingFetch.mockResolvedValue(new Response(JSON.stringify(configured.connection!.senderProfile), { status: 200 }));
    render(<UkrposhtaSettingsCard initial={configured} role="OWNER" />);
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти відправника Укрпошти' }));

    await waitFor(() => expect(mutatingFetch).toHaveBeenCalledWith(
      '/api/integrations/delivery/ukrposhta/sender-profile', expect.objectContaining({ method: 'PUT' }),
    ));
    const body = JSON.parse(String(mutatingFetch.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({ senderName: 'ТОВ Приклад', origin: { cityRef: '263:297', locationRef: '1' } });
    expect(body).not.toHaveProperty('ecomBearer');
    expect(body).not.toHaveProperty('counterpartyUuid');
  });

  it('clears the selected branch and disables save when the selected city is edited', async () => {
    const fetchFn = vi.fn().mockImplementation(async (request: string) => {
      const url = new URL(request, 'http://localhost');
      const payload = url.searchParams.get('type') === 'CITY'
        ? [{ ref: '263:297', provider: 'UKRPOSHTA', type: 'CITY', label: 'Луцьк, Волинська' }]
        : [{ ref: '1', provider: 'UKRPOSHTA', type: 'BRANCH', cityRef: '263:297', label: '43000 · Луцьк 1' }];
      return new Response(JSON.stringify(payload), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchFn);
    render(<UkrposhtaSettingsCard initial={active} role="OWNER" />);

    fireEvent.change(screen.getByLabelText('Назва відправника Укрпошти'), { target: { value: 'ТОВ Приклад' } });
    fireEvent.change(screen.getByLabelText('Телефон відправника Укрпошти'), { target: { value: '+380501112233' } });
    const cityInput = screen.getByLabelText('Місто відправлення Укрпошти');
    fireEvent.change(cityInput, { target: { value: 'Луцьк' } });
    fireEvent.click(await screen.findByRole('option', { name: 'Луцьк, Волинська' }));
    const branchInput = screen.getByLabelText('Відділення відправлення Укрпошти');
    fireEvent.change(branchInput, { target: { value: '43000' } });
    fireEvent.click(await screen.findByRole('option', { name: '43000 · Луцьк 1' }));

    const save = screen.getByRole('button', { name: 'Зберегти відправника Укрпошти' });
    expect(save).toBeEnabled();
    fireEvent.change(cityInput, { target: { value: 'Лу' } });

    await waitFor(() => expect(branchInput).toHaveValue(''));
    expect(save).toBeDisabled();
  });

  it('invalidates a persisted branch when the owner edits its saved city field', async () => {
    render(<UkrposhtaSettingsCard initial={configured} role="OWNER" />);
    const cityInput = screen.getByLabelText('Місто відправлення Укрпошти');
    const branchInput = screen.getByLabelText('Відділення відправлення Укрпошти');
    const save = screen.getByRole('button', { name: 'Зберегти відправника Укрпошти' });

    expect(branchInput).toHaveValue('43000 · Луцьк 1');
    expect(save).toBeEnabled();
    fireEvent.change(cityInput, { target: { value: 'Лу' } });

    await waitFor(() => expect(branchInput).toHaveValue(''));
    expect(save).toBeDisabled();
  });

  it('lets an owner choose production with an inline warning and submit one complete credential bundle', async () => {
    mutatingFetch.mockResolvedValue(new Response(JSON.stringify({ ...active.connection, environment: 'PRODUCTION' }), { status: 200 }));
    render(<UkrposhtaSettingsCard initial={disconnected} role="OWNER" />);
    fireEvent.change(screen.getByLabelText('Середовище Укрпошти'), { target: { value: 'PRODUCTION' } });
    expect(screen.getByText('Бойове середовище', { selector: '.ukrposhta-production-warning strong' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('eCom bearer'), { target: { value: 'ecom-bearer-secret' } });
    fireEvent.change(screen.getByLabelText('Токен контрагента'), { target: { value: 'counterparty-token-secret' } });
    fireEvent.change(screen.getByLabelText('StatusTracking bearer'), { target: { value: 'tracking-bearer-secret' } });
    fireEvent.change(screen.getByLabelText('UUID контрагента'), { target: { value: '8458f0b0-930f-11e2-a91e-003048d2b473' } });
    fireEvent.click(screen.getByRole('button', { name: 'Підключити Укрпошту' }));

    await waitFor(() => expect(mutatingFetch).toHaveBeenCalledWith('/api/integrations/delivery/ukrposhta', expect.objectContaining({ method: 'PUT' })));
    expect(JSON.parse(String(mutatingFetch.mock.calls[0]?.[1]?.body))).toEqual({
      environment: 'PRODUCTION', ecomBearer: 'ecom-bearer-secret', counterpartyToken: 'counterparty-token-secret',
      trackingBearer: 'tracking-bearer-secret', counterpartyUuid: '8458f0b0-930f-11e2-a91e-003048d2b473',
    });
    await waitFor(() => expect(screen.getByLabelText('eCom bearer')).toHaveValue(''));
    expect(screen.getByLabelText('Токен контрагента')).toHaveValue('');
    expect(screen.getByLabelText('StatusTracking bearer')).toHaveValue('');
    expect(screen.getByLabelText('UUID контрагента')).toHaveValue('');
    expect(screen.getByText(/Особистому кабінеті/)).toBeInTheDocument();
  });
});
