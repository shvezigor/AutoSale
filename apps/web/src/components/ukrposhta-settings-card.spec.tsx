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
    lastVerifiedAt: '2026-09-12T08:00:00.000Z', lastErrorCode: null, environment: 'SANDBOX',
  },
};

afterEach(() => {
  cleanup();
  mutatingFetch.mockReset();
});

describe('UkrposhtaSettingsCard', () => {
  it('shows managers only the safe connection state', () => {
    render(<UkrposhtaSettingsCard initial={active} role="MANAGER" />);
    expect(screen.getByText('ТОВ Приклад · тестове середовище')).toBeInTheDocument();
    expect(screen.getByText('Тестове середовище')).toBeInTheDocument();
    expect(screen.queryByLabelText('eCom bearer')).not.toBeInTheDocument();
    expect(screen.queryByText(/Особистому кабінеті/)).not.toBeInTheDocument();
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
