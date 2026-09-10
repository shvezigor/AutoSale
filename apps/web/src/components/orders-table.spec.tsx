import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ManagerOrder } from '../../../../packages/contracts/src/orders';

const push = vi.fn();
const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace }) }));

import { OrdersTable } from './orders-table';

const order: ManagerOrder = {
  id: '11111111-1111-4111-8111-111111111111',
  status: 'NEEDS_REVIEW',
  participantName: 'Davida Shvets',
  channel: 'INSTAGRAM',
  overallConfidence: 0.95,
  validationIssues: [],
  customer: { name: 'Ігор Швець', phone: '0976536783', instagramUsername: 'davidashvets' },
  delivery: { city: 'Луцьк', address: null, novaPoshtaBranch: '22 Кравчука' },
  items: [{ id: 'item-1', catalogId: 'VIN-1200', productName: 'Авангард VINARIT', originalText: 'двері 1200x2050', quantity: 1, color: null, size: '1200x2050', confidence: 0.95, procurementStatus: 'TO_ORDER', procurementSource: 'AUTO', procurementReason: 'STOCK_UNKNOWN', stockAtDecision: null, availableAtDecision: null, reservation: null }],
  procurementSummary: 'NEEDS_ORDER',
  procurementHandedOffAt: null,
  supplierDispatch: null,
  catalogueCandidates: [],
  createdAt: '2026-09-08T09:30:00.000Z',
  sheetsExport: null,
};

afterEach(() => { cleanup(); push.mockReset(); replace.mockReset(); });

describe('OrdersTable', () => {
  it('opens an order by clicking its row while keeping a clear link action', () => {
    render(<OrdersTable orders={[order]} page={1} pageSize={25} total={1} />);

    fireEvent.click(screen.getByRole('row', { name: /Авангард VINARIT/ }));
    expect(push).toHaveBeenCalledWith(`/orders/${order.id}`);

    push.mockReset();
    const action = screen.getAllByRole('link', { name: 'Переглянути замовлення Davida Shvets: Авангард VINARIT' })[0]!;
    action.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(action);
    expect(push).not.toHaveBeenCalled();
  });

  it('keeps search, approval, procurement and pagination in the URL without scrolling to the top', () => {
    render(<OrdersTable orders={[order]} page={2} pageSize={25} total={60} search="Авангард" status="NEEDS_REVIEW" procurementStatus="NEEDS_ORDER" />);

    fireEvent.change(screen.getByLabelText('Пошук замовлень'), { target: { value: 'Ігор' } });
    fireEvent.submit(screen.getByRole('search'));
    expect(replace).toHaveBeenCalledWith('/orders?search=%D0%86%D0%B3%D0%BE%D1%80&status=NEEDS_REVIEW&procurementStatus=NEEDS_ORDER', { scroll: false });

    fireEvent.change(screen.getByLabelText('Статус замовлення'), { target: { value: 'APPROVED' } });
    expect(replace).toHaveBeenCalledWith('/orders?search=%D0%86%D0%B3%D0%BE%D1%80&status=APPROVED&procurementStatus=NEEDS_ORDER', { scroll: false });

    fireEvent.change(screen.getByLabelText('Комплектація'), { target: { value: 'READY' } });
    expect(replace).toHaveBeenCalledWith('/orders?search=%D0%86%D0%B3%D0%BE%D1%80&status=APPROVED&procurementStatus=READY', { scroll: false });

    fireEvent.click(screen.getByRole('button', { name: 'Сторінка 3' }));
    expect(replace).toHaveBeenCalledWith('/orders?search=%D0%86%D0%B3%D0%BE%D1%80&status=APPROVED&procurementStatus=READY&page=3', { scroll: false });
  });

  it('provides a compact mobile card representation and an informative filtered empty state', () => {
    const { rerender } = render(<OrdersTable orders={[order]} page={1} pageSize={25} total={1} />);
    expect(document.querySelector('.orders-cards')).not.toBeNull();
    expect(document.querySelectorAll('.order-table-status')).toHaveLength(2);

    rerender(<OrdersTable orders={[]} page={1} pageSize={25} total={0} search="неіснуючий" />);
    expect(screen.getByRole('status')).toHaveTextContent('Замовлень за цим запитом не знайдено.');
  });

  it('renders order dates in the workspace timezone', () => {
    render(<OrdersTable orders={[order]} page={1} pageSize={25} total={1} />);

    expect(screen.getAllByText('8 вер. 2026 р., 12:30')).toHaveLength(2);
  });

  it('shows procurement status in the desktop table and mobile card', () => {
    render(<OrdersTable orders={[order]} page={1} pageSize={25} total={1} />);

    expect(screen.getByRole('columnheader', { name: 'Комплектація' })).toBeInTheDocument();
    expect(document.querySelectorAll('.procurement-badge')).toHaveLength(2);
    expect([...document.querySelectorAll('.procurement-badge')].every((badge) => badge.textContent === 'Потрібно замовити')).toBe(true);
  });
});
