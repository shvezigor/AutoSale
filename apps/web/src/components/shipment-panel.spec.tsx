import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagerOrder } from '../../../../packages/contracts/src/orders';

import { ShipmentPanel } from './shipment-panel';
import { ToastProvider } from './toast-provider';

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
    render(<ToastProvider><ShipmentPanel order={{ ...order, canCreateShipment: false, procurementSummary: 'NEEDS_ORDER' }} /></ToastProvider>);
    expect(screen.getByRole('button', { name: 'Оформити доставку' })).toBeDisabled();
    expect(screen.getByText(/всі товари будуть на складі/i)).toBeInTheDocument();
  });

  it('opens the shipment review without navigating away', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    render(<ToastProvider><ShipmentPanel order={order} /></ToastProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Оформити доставку' }));
    expect(screen.getByRole('dialog', { name: 'Оформлення доставки' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Закрити' })).toHaveFocus();
  });
});
