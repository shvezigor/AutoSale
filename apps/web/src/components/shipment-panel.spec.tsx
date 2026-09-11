import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagerOrder } from '../../../../packages/contracts/src/orders';

import { ShipmentPanel } from './shipment-panel';
import { ToastProvider } from './toast-provider';
import { ConfirmProvider } from './confirm-provider';

const order = {
  id: '11111111-1111-4111-8111-111111111111', status: 'APPROVED', participantName: 'Олена', channel: 'INSTAGRAM',
  overallConfidence: 1, validationIssues: [], customer: { name: 'Олена', phone: '+380671234567', instagramUsername: 'olena' },
  delivery: { city: 'Київ', address: null, novaPoshtaBranch: '24' }, items: [], procurementSummary: 'READY',
  procurementHandedOffAt: null, supplierDispatch: null, shipment: null, canCreateShipment: true,
  catalogueCandidates: [], createdAt: '2026-09-11T00:00:00.000Z', sheetsExport: null,
} satisfies ManagerOrder;

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('ShipmentPanel', () => {
  it('shows a clear disabled reason until procurement is complete', () => {
    render(<ConfirmProvider><ToastProvider><ShipmentPanel order={{ ...order, canCreateShipment: false, procurementSummary: 'NEEDS_ORDER' }} /></ToastProvider></ConfirmProvider>);
    expect(screen.getByRole('button', { name: 'Оформити доставку' })).toBeDisabled();
    expect(screen.getByText(/всі товари будуть на складі/i)).toBeInTheDocument();
  });

  it('opens the shipment review without navigating away', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    render(<ConfirmProvider><ToastProvider><ShipmentPanel order={order} /></ToastProvider></ConfirmProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Оформити доставку' }));
    expect(screen.getByRole('dialog', { name: 'Оформлення доставки' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Закрити' })).toHaveFocus();
  });

  it('offers an explicit customer message only for a created TTN', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    render(<ConfirmProvider><ToastProvider><ShipmentPanel order={{ ...order, shipment: {
      id: 'shipment-id', orderId: order.id, provider: 'NOVA_POSHTA', status: 'CREATED', trackingNumber: '20450000000000',
      cost: 120, currency: 'UAH', createdAt: '2026-09-11T00:00:00.000Z', providerCreatedAt: '2026-09-11T00:01:00.000Z',
      acceptedAt: null, deliveredAt: null, cancelledAt: null, lastStatusCheckedAt: null, lastErrorCode: null, history: [],
    } }} /></ToastProvider></ConfirmProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Повідомити клієнта' }));
    expect(screen.getByRole('dialog', { name: 'Повідомити клієнта про ТТН' })).toBeInTheDocument();
    expect(screen.getAllByText('ТТН 20450000000000')).toHaveLength(2);
  });
});
