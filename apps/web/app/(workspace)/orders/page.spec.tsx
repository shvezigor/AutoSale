import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const { getOrders } = vi.hoisted(() => ({ getOrders: vi.fn() }));
vi.mock('../../../src/api/orders', () => ({ getOrders }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

import OrdersPage from './page';

const order = {
  id: '11111111-1111-4111-8111-111111111111',
  status: 'NEEDS_REVIEW' as const,
  participantName: 'Davida Shvets',
  channel: 'INSTAGRAM' as const,
  overallConfidence: 0.95,
  validationIssues: [],
  customer: { name: 'Ігор Швець', phone: '0976536783', instagramUsername: 'davidashvets' },
  delivery: { city: 'Луцьк', address: null, novaPoshtaBranch: '22 Кравчука' },
  items: [{ id: 'item-1', catalogId: 'VIN-1200', productName: 'Авангард VINARIT', originalText: 'двері 1200x2050', quantity: 1, color: null, size: '1200x2050', confidence: 0.95, procurementStatus: 'TO_ORDER' as const, procurementSource: 'AUTO' as const, procurementReason: 'STOCK_UNKNOWN' as const, stockAtDecision: null, availableAtDecision: null, reservation: null }],
  procurementSummary: 'NEEDS_ORDER' as const,
  procurementHandedOffAt: null,
  supplierDispatch: null,
  catalogueCandidates: [],
  createdAt: '2026-09-08T09:30:00.000Z',
  sheetsExport: null,
};

afterEach(() => { cleanup(); getOrders.mockReset(); });

it('presents orders as a data table with a clear view action', async () => {
  getOrders.mockResolvedValue({ items: [order], page: 1, pageSize: 25, total: 1 });

  render(await OrdersPage({ searchParams: Promise.resolve({}) }));

  expect(screen.getByRole('table', { name: 'Замовлення' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Товар' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Клієнт' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Доставка' })).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: 'Переглянути замовлення Davida Shvets: Авангард VINARIT' })[0]).toHaveAttribute('href', `/orders/${order.id}`);
});
