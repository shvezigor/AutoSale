import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShipmentOverview } from '../../../../packages/contracts/src/delivery';

import { ShipmentReviewDialog } from './shipment-review-dialog';
import { I18nProvider } from '../i18n/i18n-provider';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { ToastProvider } from './toast-provider';

const orderId = '11111111-1111-4111-8111-111111111111';
const exactOverview: ShipmentOverview = {
  shipment: null, canCreateShipment: true, blockedReason: null,
  draft: {
    provider: 'NOVA_POSHTA', recipient: { name: 'Олена', phone: '+380671234567' },
    destination: { type: 'BRANCH', cityRef: 'city-ref', locationRef: 'branch-ref', label: 'Відділення №24' },
    parcels: [{ weightKg: 2, lengthCm: 80, widthCm: 20, heightCm: 205 }], payer: 'RECIPIENT',
    declaredValue: 5000, codAmount: null, description: 'Двері Авангард',
  },
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.body.style.overflow = ''; });

function renderDialog(props: Partial<Parameters<typeof ShipmentReviewDialog>[0]> = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(<ToastProvider><ShipmentReviewDialog orderId={orderId} onClose={onClose} onSaved={onSaved} {...props} /></ToastProvider>);
  return { onClose, onSaved };
}

describe('ShipmentReviewDialog', () => {
  it('translates the form while preserving recipient and location values', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (path: string) => ({
      ok: true,
      json: async () => path.includes('csrf') ? { token: 'csrf-token' } : path.includes('quote') ? { cost: 120, estimatedDeliveryDate: null } : exactOverview,
    })));
    render(<I18nProvider locale="en" authenticated={false}><ToastProvider><ShipmentReviewDialog orderId="order-id" onClose={vi.fn()} onSaved={vi.fn()} /></ToastProvider></I18nProvider>);
    expect(await screen.findByRole('dialog', { name: 'Set up shipment' })).toBeInTheDocument();
    expect(screen.getByLabelText('Recipient name')).toHaveValue('Олена');
    expect(screen.getByDisplayValue('Відділення №24')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create TTN' })).toBeInTheDocument();
  });
  it('shows a recoverable quote error instead of an endless loader', async () => {
    const fetchMock = vi.fn().mockImplementation(async (path: string) => ({ ok: !path.includes('quote'), json: async () => path.includes('csrf') ? { token: 'csrf-token' } : exactOverview }));
    vi.stubGlobal('fetch', fetchMock);
    renderDialog();
    expect(await screen.findByText(/Не вдалося розрахувати вартість/)).toBeInTheDocument();
    expect(screen.queryByText('Розраховуємо вартість…')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Зберегти чернетку' })).toBeEnabled();
  });
  it('switches to an active Ukrposhta connection, limits destination to branches and respects create gate', async () => {
    const ukrposhta = { ...exactOverview, availableProviders: ['NOVA_POSHTA', 'UKRPOSHTA'], creationEnabled: false, draft: { ...exactOverview.draft, provider: 'UKRPOSHTA', recipient: { name: 'Петренко Олена', phone: '+380671234567' }, destination: { type: 'BRANCH', cityRef: '263:297', locationRef: 'up:1:43000', label: 'Луцьк' } } };
    const fetchMock = vi.fn().mockImplementation(async (path: string) => ({ ok: true, json: async () => path.includes('provider=UKRPOSHTA') ? ukrposhta : path.includes('quote') ? { currency: 'UAH', cost: 90, estimatedDeliveryDate: null } : path.includes('csrf') ? { token: 'csrf-token' } : { ...exactOverview, availableProviders: ['NOVA_POSHTA', 'UKRPOSHTA'] } }));
    vi.stubGlobal('fetch', fetchMock);
    renderDialog();
    fireEvent.change(await screen.findByLabelText('Перевізник'), { target: { value: 'UKRPOSHTA' } });
    await screen.findByDisplayValue('Петренко Олена');
    expect(screen.queryByRole('option', { name: 'Поштомат' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Створити ТТН' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Зберегти чернетку' })).toBeEnabled();
    expect(await screen.findByText('90 грн')).toBeInTheDocument();
    expect(screen.getByText(/Створення відправлень Укрпошти ще не увімкнено/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти чернетку' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/orders/${orderId}/shipments/draft`, expect.objectContaining({ body: expect.stringContaining('"locationRef":"up:1:43000"') })));
  });

  it('creates an enabled Ukrposhta draft with selected payer and description after quote review', async () => {
    const overview = { ...exactOverview, availableProviders: ['UKRPOSHTA'], creationEnabled: true, draft: { ...exactOverview.draft, provider: 'UKRPOSHTA', recipient: { name: 'Петренко Олена', phone: '+380671234567' }, destination: { type: 'BRANCH', cityRef: '263:297', locationRef: 'up:1:43000', label: 'Луцьк' } } };
    const fetchMock = vi.fn().mockImplementation(async (path: string, init?: RequestInit) => ({ ok: true, json: async () => path.includes('csrf') ? { token: 'csrf-token' } : path.includes('quote') ? { currency: 'UAH', cost: 90, estimatedDeliveryDate: null } : init?.method === 'POST' ? { id: 'shipment-id', provider: 'UKRPOSHTA', status: 'CREATING' } : overview }));
    vi.stubGlobal('fetch', fetchMock);
    const { onSaved } = renderDialog();
    await screen.findByText('90 грн');
    fireEvent.change(screen.getByLabelText('Платник доставки'), { target: { value: 'SENDER' } });
    fireEvent.change(screen.getByLabelText('Опис відправлення'), { target: { value: 'Двері' } });
    await screen.findByText('90 грн');
    fireEvent.click(screen.getByRole('button', { name: 'Створити ТТН' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ provider: 'UKRPOSHTA', status: 'CREATING' })));
    const body = JSON.parse(fetchMock.mock.calls.find(([path]) => path.endsWith('/draft'))![1]!.body as string);
    expect(body).toMatchObject({ provider: 'UKRPOSHTA', payer: 'SENDER', description: 'Двері', destination: { locationRef: 'up:1:43000' } });
  });
  it('blocks an Ukrposhta recipient with one-letter name tokens before save or enqueue', async () => {
    const overview = { ...exactOverview, availableProviders: ['UKRPOSHTA'], creationEnabled: true, draft: { ...exactOverview.draft, provider: 'UKRPOSHTA', recipient: { name: 'І Я', phone: '+380671234567' }, destination: { type: 'BRANCH', cityRef: '263:297', locationRef: 'up:1:43000', label: 'Луцьк' } } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => overview }));
    renderDialog();
    await screen.findByDisplayValue('І Я');
    expect(screen.getByRole('button', { name: 'Зберегти чернетку' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Створити ТТН' })).toBeDisabled();
  });
  it('loads prefilled fields, locks background scroll and closes on Escape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => exactOverview }));
    const { onClose } = renderDialog();
    expect(document.body.style.overflow).toBe('hidden');
    expect(await screen.findByDisplayValue('Олена')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Відділення №24')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('traps keyboard focus inside the dialog', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => exactOverview }));
    renderDialog();
    const close = screen.getByRole('button', { name: 'Закрити' });
    const create = await screen.findByRole('button', { name: 'Створити ТТН' });
    create.focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(create).toHaveFocus();
  });

  it('saves the exact draft and issues one create command from a stable loading button', async () => {
    const draftShipment = { id: 'shipment-id', status: 'DRAFT' };
    const creatingShipment = { id: 'shipment-id', status: 'CREATING' };
    const fetchMock = vi.fn().mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === `/api/orders/${orderId}/shipments` && init?.method === 'POST') return { ok: true, json: async () => creatingShipment };
      if (path === `/api/orders/${orderId}/shipments`) return { ok: true, json: async () => exactOverview };
      if (path === `/api/orders/${orderId}/shipments/draft`) return { ok: true, json: async () => draftShipment };
      if (path === `/api/orders/${orderId}/shipments/quote`) return { ok: true, json: async () => ({ currency: 'UAH', cost: 120, estimatedDeliveryDate: null }) };
      if (path === '/api/auth/csrf') return { ok: true, json: async () => ({ token: 'csrf-token' }) };
      return { ok: true, json: async () => exactOverview };
    });
    vi.stubGlobal('fetch', fetchMock);
    const { onSaved } = renderDialog();
    await screen.findByDisplayValue('Олена');
    fireEvent.click(screen.getByRole('button', { name: 'Створити ТТН' }));
    expect(screen.getByRole('button', { name: 'Створюємо ТТН…' })).toBeDisabled();
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(creatingShipment));
    expect(fetchMock).toHaveBeenCalledWith(`/api/orders/${orderId}/shipments/draft`, expect.objectContaining({ method: 'PUT' }));
    expect(fetchMock.mock.calls.filter(([path, init]) => path === `/api/orders/${orderId}/shipments` && init?.method === 'POST')).toHaveLength(1);
  });

  it('blocks COD above the declared value', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => exactOverview }));
    renderDialog();
    await screen.findByDisplayValue('Олена');
    fireEvent.change(screen.getByLabelText('Післяплата, грн'), { target: { value: '6000' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Післяплата не може перевищувати');
    expect(screen.getByRole('button', { name: 'Зберегти чернетку' })).toBeDisabled();
  });

  it('refreshes the quote automatically after a complete draft is available', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => exactOverview })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf-token' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ currency: 'UAH', cost: 120, estimatedDeliveryDate: '2026-09-13' }) });
    vi.stubGlobal('fetch', fetchMock);
    renderDialog();
    expect(await screen.findByText('120 грн')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(`/api/orders/${orderId}/shipments/quote`, expect.objectContaining({ method: 'POST' }));
  });
});
