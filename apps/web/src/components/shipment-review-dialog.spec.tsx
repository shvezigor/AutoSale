import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShipmentOverview } from '../../../../packages/contracts/src/delivery';

import { ShipmentReviewDialog } from './shipment-review-dialog';
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
  it('loads prefilled fields, locks background scroll and closes on Escape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => exactOverview }));
    const { onClose } = renderDialog();
    expect(document.body.style.overflow).toBe('hidden');
    expect(await screen.findByDisplayValue('Олена')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Відділення №24')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('persists a complete exact draft while keeping create disabled until the next task', async () => {
    const shipment = { id: 'shipment-id', status: 'DRAFT' };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => exactOverview })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf-token' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => shipment });
    vi.stubGlobal('fetch', fetchMock);
    const { onSaved } = renderDialog();
    await screen.findByDisplayValue('Олена');
    expect(screen.getByRole('button', { name: 'Створити ТТН' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти чернетку' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(shipment));
    expect(fetchMock).toHaveBeenCalledWith(`/api/orders/${orderId}/shipments/draft`, expect.objectContaining({ method: 'PUT' }));
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
