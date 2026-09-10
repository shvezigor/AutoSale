import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActivityProvider } from './activity-provider';
import { SupplierDispatchDialog } from './supplier-dispatch-dialog';
import { ToastProvider } from './toast-provider';

const preview = {
  orderId: '11111111-1111-4111-8111-111111111111',
  companyName: 'Магазин Двері',
  supplierName: 'Основний постачальник',
  items: [
    { orderItemId: 'item-1', productName: 'Двері Авангард', sku: 'SKU-1', quantity: 2, color: 'білий', size: '860x2050' },
  ],
};

function renderDialog(onClose = vi.fn(), onDispatched = vi.fn()) {
  return { onClose, onDispatched, ...render(<ToastProvider><ActivityProvider><SupplierDispatchDialog
    onClose={onClose}
    onDispatched={onDispatched}
    open
    orderId={preview.orderId}
  /></ActivityProvider></ToastProvider>) };
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('SupplierDispatchDialog', () => {
  it('loads a privacy-safe preview only when opened and cancel sends nothing', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => preview });
    vi.stubGlobal('fetch', fetchMock);
    const view = renderDialog();

    expect(await screen.findByRole('dialog', { name: 'Надіслати замовлення постачальнику' })).toBeInTheDocument();
    expect(screen.getByText('Магазин Двері')).toBeInTheDocument();
    expect(screen.getByText('Основний постачальник')).toBeInTheDocument();
    expect(screen.getByText(/Двері Авангард/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }));

    expect(view.onClose).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(`/api/integrations/telegram/supplier/orders/${preview.orderId}/preview`);
  });

  it('confirms exactly once with stable progress and reports the queued delivery', async () => {
    let finish!: (value: { ok: boolean; json: () => Promise<unknown> }) => void;
    const pending = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => { finish = resolve; });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => preview })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf-token' }) })
      .mockReturnValueOnce(pending);
    vi.stubGlobal('fetch', fetchMock);
    const view = renderDialog();
    await screen.findByText('Основний постачальник');

    fireEvent.click(screen.getByRole('button', { name: 'Надіслати' }));
    fireEvent.click(screen.getByRole('button', { name: 'Надсилаємо…' }));

    expect(screen.getByRole('button', { name: 'Надсилаємо…' })).toHaveAttribute('aria-busy', 'true');
    finish({ ok: true, json: async () => ({ deliveryId: 'delivery-1', status: 'PENDING' }) });
    await waitFor(() => expect(view.onDispatched).toHaveBeenCalledWith({ deliveryId: 'delivery-1', status: 'PENDING' }));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/integrations/telegram/supplier/orders/${preview.orderId}`,
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
