import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagerOrder } from '../../../../packages/contracts/src/orders';

import { ShipmentPanel } from './shipment-panel';
import { ToastProvider } from './toast-provider';
import { ConfirmProvider } from './confirm-provider';
import { I18nProvider } from '../i18n/i18n-provider';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const order = {
  id: '11111111-1111-4111-8111-111111111111', publicNumber: 'AS-260918', status: 'APPROVED', participantName: 'Олена', channel: 'INSTAGRAM',
  overallConfidence: 1, validationIssues: [], customer: { name: 'Олена', phone: '+380671234567', instagramUsername: 'olena' },
  delivery: { city: 'Київ', address: null, novaPoshtaBranch: '24' }, items: [], procurementSummary: 'READY',
  procurementHandedOffAt: null, supplierDispatch: null, shipment: null, canCreateShipment: true,
  catalogueCandidates: [], createdAt: '2026-09-11T00:00:00.000Z', sheetsExport: null,
  commercialTerms: null,
  paymentSummary: null,
} satisfies ManagerOrder;

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('ShipmentPanel', () => {
  it('translates shipment controls while preserving shipment data', () => {
    render(<I18nProvider locale="en" authenticated={false}><ConfirmProvider><ToastProvider><ShipmentPanel order={{ ...order, shipment: {
      id: 'shipment-id', orderId: order.id, provider: 'NOVA_POSHTA', status: 'CREATED', trackingNumber: '20450000000000',
      cost: 120, currency: 'UAH', createdAt: '2026-09-11T00:00:00.000Z', providerCreatedAt: null,
      acceptedAt: null, deliveredAt: null, cancelledAt: null, lastStatusCheckedAt: null, lastErrorCode: null, history: [],
    } }} /></ToastProvider></ConfirmProvider></I18nProvider>);
    expect(screen.getByText('Shipment created')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notify customer' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Track shipment' })).toBeInTheDocument();
    expect(screen.getByText('TTN 20450000000000')).toBeInTheDocument();
  });
  it('stops the cancellation loader and explains a terminal Ukrposhta failure', async () => {
    const shipment = { id: 'shipment-id', orderId: order.id, provider: 'UKRPOSHTA' as const, status: 'CREATED' as const, trackingNumber: '0500113014256', cost: 90, currency: 'UAH' as const, createdAt: '2026-09-13T00:00:00Z', providerCreatedAt: null, acceptedAt: null, deliveredAt: null, cancelledAt: null, lastStatusCheckedAt: null, lastErrorCode: null, history: [] };
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (path: string) => ({ ok: true, json: async () => path.includes('csrf') ? { token: 'csrf-token' } : { shipment: { ...shipment, lastErrorCode: 'UKRPOSHTA_UNAUTHORIZED' } } })));
    render(<ConfirmProvider><ToastProvider><ShipmentPanel order={{ ...order, shipment }} /></ToastProvider></ConfirmProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Скасувати ТТН' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Так, скасувати' }));
    expect(await screen.findByText(/Не вдалося завершити дію з відправленням/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Скасувати ТТН' })).not.toBeInTheDocument();
  });
  it('shows Ukrposhta tracking, final cost and labels, and hides cancellation after acceptance', () => {
    render(<ConfirmProvider><ToastProvider><ShipmentPanel order={{ ...order, shipment: {
      id: 'shipment-id', orderId: order.id, provider: 'UKRPOSHTA', status: 'ACCEPTED', trackingNumber: '0500113014256', cost: 90, currency: 'UAH', createdAt: '2026-09-13T00:00:00Z', providerCreatedAt: null, acceptedAt: null, deliveredAt: null, cancelledAt: null, lastStatusCheckedAt: null, lastErrorCode: null, history: [],
    } }} /></ToastProvider></ConfirmProvider>);
    expect(screen.getByRole('heading', { name: 'Укрпошта' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Відстежити' })).toHaveAttribute('href', 'https://track.ukrposhta.ua/tracking_UA.html?barcode=0500113014256');
    expect(screen.getByRole('link', { name: 'Завантажити етикетку' })).toHaveAttribute('href', '/api/shipments/shipment-id/label');
    expect(screen.queryByRole('button', { name: 'Скасувати ТТН' })).not.toBeInTheDocument();
    expect(screen.getByText('90 грн')).toBeInTheDocument();
  });
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

  it('returns focus to the delivery action after closing the drawer', async () => {
    render(<ToastProvider><ConfirmProvider><ShipmentPanel order={{ ...order, shipment: null }} /></ConfirmProvider></ToastProvider>);
    const trigger = screen.getByRole('button', { name: 'Оформити доставку' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Закрити' }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
