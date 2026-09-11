import { cleanup, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mutatingFetch } = vi.hoisted(() => ({ mutatingFetch: vi.fn() }));
vi.mock('../auth/csrf-fetch', () => ({ mutatingFetch }));

import { ActivityProvider } from './activity-provider';
import { ConfirmProvider } from './confirm-provider';
import { DeliverySettingsCard, type DeliverySettingsSummary } from './delivery-settings-card';
import { ToastProvider } from './toast-provider';

function render(ui: React.ReactElement) {
  return rtlRender(<ToastProvider><ActivityProvider><ConfirmProvider>{ui}</ConfirmProvider></ActivityProvider></ToastProvider>);
}

const disconnected: DeliverySettingsSummary = { enabled: true, connections: [] };
const active: DeliverySettingsSummary = {
  enabled: true,
  connections: [{
    provider: 'NOVA_POSHTA', status: 'ACTIVE', accountLabel: 'ТОВ Приклад',
    lastVerifiedAt: '2026-09-11T08:00:00.000Z', lastErrorCode: null, senderProfile: null,
  }],
};

afterEach(() => {
  cleanup();
  mutatingFetch.mockReset();
  vi.unstubAllGlobals();
});

describe('DeliverySettingsCard', () => {
  it('shows a masked read-only state to managers', () => {
    render(<DeliverySettingsCard initial={active} role="MANAGER" />);
    expect(screen.getByText('ТОВ Приклад')).toBeInTheDocument();
    expect(screen.getByText('Активне')).toBeInTheDocument();
    expect(screen.queryByLabelText('API-ключ Нової Пошти')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Відключити/ })).not.toBeInTheDocument();
  });

  it('connects with stable progress and never renders the submitted key', async () => {
    let resolveRequest!: (value: Response) => void;
    mutatingFetch.mockImplementation(() => new Promise<Response>((resolve) => { resolveRequest = resolve; }));
    render(<DeliverySettingsCard initial={disconnected} role="OWNER" />);
    fireEvent.change(screen.getByLabelText('API-ключ Нової Пошти'), { target: { value: 'np-live-secret-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Підключити вручну' }));

    expect(await screen.findByRole('button', { name: 'Підключаємо…' })).toBeDisabled();
    expect(screen.getByRole('progressbar', { name: 'Підключаємо Нову Пошту' })).toBeInTheDocument();
    resolveRequest(new Response(JSON.stringify(active.connections[0]), { status: 200 }));

    await screen.findByText('Нову Пошту підключено');
    expect(screen.queryByDisplayValue('np-live-secret-key')).not.toBeInTheDocument();
    expect(JSON.stringify(active)).not.toContain('np-live-secret-key');
  });

  it('opens the official cabinet and connects directly from an explicitly requested clipboard read', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: vi.fn().mockResolvedValue('np-key-from-clipboard') },
    });
    mutatingFetch.mockResolvedValue(new Response(JSON.stringify(active.connections[0]), { status: 200 }));
    render(<DeliverySettingsCard initial={disconnected} role="OWNER" />);

    const cabinet = screen.getByRole('link', { name: 'Відкрити кабінет Нової Пошти' });
    expect(cabinet).toHaveAttribute('href', 'https://my.novaposhta.ua/');
    expect(cabinet).toHaveAttribute('target', '_blank');

    fireEvent.click(screen.getByRole('button', { name: 'Вставити ключ і підключити' }));
    await waitFor(() => expect(mutatingFetch).toHaveBeenCalledWith(
      '/api/integrations/delivery/nova-poshta',
      expect.objectContaining({ body: JSON.stringify({ apiKey: 'np-key-from-clipboard' }) }),
    ));
    expect(await screen.findByText('Нову Пошту підключено')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('np-key-from-clipboard')).not.toBeInTheDocument();
  });

  it('explains how to paste manually when clipboard access is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError')) },
    });
    render(<DeliverySettingsCard initial={disconnected} role="OWNER" />);
    fireEvent.click(screen.getByRole('button', { name: 'Вставити ключ і підключити' }));
    expect(await screen.findByText('Не вдалося прочитати буфер обміну')).toBeInTheDocument();
    expect(screen.getByText('Вставте ключ у поле вручну — браузер не надав доступ до буфера.')).toBeInTheDocument();
    expect(mutatingFetch).not.toHaveBeenCalled();
  });

  it('shows sender, contact, origin and parcel defaults for the owner', () => {
    render(<DeliverySettingsCard initial={active} role="OWNER" />);
    expect(screen.getByLabelText('Відправник')).toBeInTheDocument();
    expect(screen.getByLabelText('Контактна особа')).toBeInTheDocument();
    expect(screen.getByLabelText('Телефон відправника')).toBeInTheDocument();
    expect(screen.getByLabelText('Точка відправлення')).toBeInTheDocument();
    expect(screen.queryByLabelText('Місто відправлення')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Хто оплачує доставку')).toBeInTheDocument();
    expect(screen.getByLabelText('Вага, кг')).toBeInTheDocument();
    expect(screen.getByLabelText('Шаблон повідомлення клієнту')).toHaveValue('{company}: створено ТТН {trackingNumber}. Відстеження: {trackingUrl}');
  });

  it('saves an editable customer TTN message template', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 })));
    mutatingFetch.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    render(<DeliverySettingsCard initial={active} role="OWNER" />);
    fireEvent.change(screen.getByLabelText('Шаблон повідомлення клієнту'), { target: { value: '{company}: ваша ТТН {trackingNumber}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти дані відправника' }));
    await waitFor(() => expect(mutatingFetch).toHaveBeenCalledWith(
      '/api/integrations/delivery/nova-poshta/sender-profile',
      expect.objectContaining({ body: expect.stringContaining('ваша ТТН {trackingNumber}') }),
    ));
  });

  it('loads provider choices and fills contact and origin without manual refs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([{
      ref: 'sender-ref', label: 'ТОВ Приклад', edrpou: '12345678',
      contacts: [{ ref: 'contact-ref', label: 'Ігор Швець', phone: '+380501112233' }],
      origins: [{ ref: 'branch-ref', cityRef: 'city-ref', label: 'Відділення №1', number: '1', type: 'BRANCH' }],
    }]), { status: 200 })));
    render(<DeliverySettingsCard initial={active} role="OWNER" />);

    const sender = await screen.findByRole('option', { name: 'ТОВ Приклад' });
    fireEvent.change(screen.getByLabelText('Відправник'), { target: { value: sender.getAttribute('value') } });
    expect(screen.getByRole('option', { name: 'Ігор Швець' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('+380501112233')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Відділення №1' })).toBeInTheDocument();
  });

  it('automatically selects the only sender profile returned by Nova Poshta', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([{
      ref: 'only-sender', label: 'Єдиний відправник', edrpou: null,
      contacts: [{ ref: 'only-contact', label: 'Ігор Швець', phone: '+380501112233' }],
      origins: [{ ref: 'only-branch', cityRef: 'only-city', label: 'Відділення №1', number: '1', type: 'BRANCH' }],
    }]), { status: 200 })));
    render(<DeliverySettingsCard initial={active} role="OWNER" />);

    await waitFor(() => expect(screen.getByLabelText('Відправник')).toHaveValue('only-sender'));
    expect(screen.getByLabelText('Контактна особа')).toHaveValue('only-contact');
    expect(screen.getByLabelText('Точка відправлення')).toHaveValue('only-branch');
    expect(screen.getByLabelText('Телефон відправника')).toHaveValue('+380501112233');
  });

  it('saves sender defaults through the tenant endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([{
      ref: 'sender-ref', label: 'ТОВ Приклад', edrpou: '12345678',
      contacts: [{ ref: 'contact-ref', label: 'Ігор Швець', phone: '+380501112233' }],
      origins: [{ ref: 'branch-ref', cityRef: 'city-ref', label: 'Відділення №1', number: '1', type: 'BRANCH' }],
    }]), { status: 200 })));
    mutatingFetch.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    render(<DeliverySettingsCard initial={active} role="OWNER" />);
    await screen.findByRole('option', { name: 'ТОВ Приклад' });
    fireEvent.change(screen.getByLabelText('Відправник'), { target: { value: 'sender-ref' } });
    fireEvent.change(screen.getByLabelText('Точка відправлення'), { target: { value: 'branch-ref' } });
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти дані відправника' }));

    await waitFor(() => expect(mutatingFetch).toHaveBeenCalledWith(
      '/api/integrations/delivery/nova-poshta/sender-profile',
      expect.objectContaining({ method: 'PUT' }),
    ));
    expect(await screen.findByText('Дані відправника збережено')).toBeInTheDocument();
  });

  it('disconnects only after the global confirmation', async () => {
    mutatingFetch.mockResolvedValue(new Response(JSON.stringify({ provider: 'NOVA_POSHTA', status: 'DISCONNECTED' }), { status: 200 }));
    render(<DeliverySettingsCard initial={active} role="OWNER" />);
    fireEvent.click(screen.getByRole('button', { name: 'Відключити Нову Пошту' }));
    expect(screen.getByRole('dialog', { name: 'Відключити Нову Пошту?' })).toBeInTheDocument();
    expect(mutatingFetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Так, відключити' }));
    await waitFor(() => expect(mutatingFetch).toHaveBeenCalledWith('/api/integrations/delivery/nova-poshta', { method: 'DELETE' }));
  });

  it('shows a safe toast when connection fails', async () => {
    mutatingFetch.mockResolvedValue(new Response(JSON.stringify({ message: 'Invalid connection' }), { status: 400 }));
    render(<DeliverySettingsCard initial={disconnected} role="OWNER" />);
    fireEvent.change(screen.getByLabelText('API-ключ Нової Пошти'), { target: { value: 'np-live-secret-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Підключити вручну' }));
    expect(await screen.findByText('Не вдалося підключити Нову Пошту')).toBeInTheDocument();
    expect(screen.queryByText(/np-live-secret-key/)).not.toBeInTheDocument();
  });
});
