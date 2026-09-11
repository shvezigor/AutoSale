import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShipmentCustomerMessageDialog } from './shipment-customer-message-dialog';
import { ToastProvider } from './toast-provider';

const preview = {
  text: 'Магазин Двері: створено ТТН 20450000000000.',
  suggested: true,
  alreadySubmitted: false,
  deliveryStatus: null,
  deliveryErrorCode: null,
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('ShipmentCustomerMessageDialog', () => {
  it('loads an editable preview and queues the manager-confirmed text once', async () => {
    let finish!: (response: { ok: boolean; json: () => Promise<unknown> }) => void;
    const pending = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => { finish = resolve; });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => preview })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf' }) })
      .mockReturnValueOnce(pending);
    vi.stubGlobal('fetch', fetchMock);
    const onClose = vi.fn();
    const onSubmitted = vi.fn();
    render(<ToastProvider><ShipmentCustomerMessageDialog shipmentId="shipment-id" trackingNumber="20450000000000" onClose={onClose} onSubmitted={onSubmitted} /></ToastProvider>);

    const message = await screen.findByRole('textbox', { name: 'Повідомлення клієнту' });
    expect(message).toHaveValue(preview.text);
    fireEvent.change(message, { target: { value: 'Ваше замовлення вже їде. ТТН 20450000000000' } });
    expect(screen.getByText('43 / 1000')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Надіслати клієнту' }));

    expect(screen.getByRole('button', { name: 'Надсилаємо…' })).toHaveAttribute('aria-busy', 'true');
    finish({ ok: true, json: async () => ({ id: 'message-id', delivery: { status: 'PENDING' } }) });
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledOnce());
    expect(onClose).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/shipments/shipment-id/customer-message', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ text: 'Ваше замовлення вже їде. ТТН 20450000000000' }),
    }));
  });

  it('keeps the TTN and offers a copy fallback when Instagram rejects sending', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => preview })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf' }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(<ToastProvider><ShipmentCustomerMessageDialog shipmentId="shipment-id" trackingNumber="20450000000000" onClose={vi.fn()} onSubmitted={vi.fn()} /></ToastProvider>);

    await screen.findByRole('textbox', { name: 'Повідомлення клієнту' });
    fireEvent.click(screen.getByRole('button', { name: 'Надіслати клієнту' }));
    expect(await screen.findByText(/не вдалося передати повідомлення/i)).toBeInTheDocument();
    expect(screen.getByText('ТТН 20450000000000')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Скопіювати текст' }));
    expect(writeText).toHaveBeenCalledWith(preview.text);
  });

  it('disables a shipment version that was already submitted', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...preview, alreadySubmitted: true, deliveryStatus: 'SENT' }) }));
    render(<ToastProvider><ShipmentCustomerMessageDialog shipmentId="shipment-id" trackingNumber="20450000000000" onClose={vi.fn()} onSubmitted={vi.fn()} /></ToastProvider>);
    expect(await screen.findByText('Повідомлення вже надіслано')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Надіслано' })).toBeDisabled();
  });

  it('offers the saved text for copying when queued Instagram delivery later fails', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...preview, alreadySubmitted: true, deliveryStatus: 'FAILED', deliveryErrorCode: 'WINDOW_EXPIRED' }) }));
    render(<ToastProvider><ShipmentCustomerMessageDialog shipmentId="shipment-id" trackingNumber="20450000000000" onClose={vi.fn()} onSubmitted={vi.fn()} /></ToastProvider>);
    expect(await screen.findByText(/Instagram не доставив повідомлення/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Скопіювати текст' }));
    expect(writeText).toHaveBeenCalledWith(preview.text);
  });
});
