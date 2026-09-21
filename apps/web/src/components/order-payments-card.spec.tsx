import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderPaymentSummary } from '../../../../packages/contracts/src/payments';

import { I18nProvider } from '../i18n/i18n-provider';
import { OrderPaymentsCard } from './order-payments-card';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const { mutatingFetch } = vi.hoisted(() => ({ mutatingFetch: vi.fn() }));
vi.mock('../auth/csrf-fetch', () => ({ mutatingFetch }));

const summary: OrderPaymentSummary = {
  expectedAmount: '1000.00', paidAmount: '400.00', remainingAmount: '600.00', currency: 'UAH', status: 'PARTIALLY_PAID',
  payments: [{
    id: 'payment-1', amount: '400.00', currency: 'UAH', method: 'BANK_TRANSFER', receivedAt: '2026-09-20T10:00:00.000Z',
    bankAccount: { id: 'account-1', label: 'Основний UAH' }, carrier: null, note: 'Аванс',
    createdBy: { id: 'owner-1', name: 'Власник' }, createdAt: '2026-09-20T10:01:00.000Z',
    cancelledAt: null, cancelledBy: null, cancellationReason: null,
  }],
};
const accounts = [{ id: 'account-1', legalEntityId: 'entity-1', label: 'Основний UAH', maskedIban: 'UA••••0001', bankName: 'Test Bank', currency: 'UAH', active: true, isDefault: true }];

function renderCard(props: Partial<Parameters<typeof OrderPaymentsCard>[0]> = {}, locale: 'uk' | 'en' = 'uk') {
  return render(<I18nProvider locale={locale} authenticated={false}><OrderPaymentsCard orderId="order-1" initial={summary} accounts={accounts} role="OWNER" onChange={vi.fn()} {...props} /></I18nProvider>);
}

beforeEach(() => vi.stubGlobal('crypto', { randomUUID: vi.fn(() => '11111111-1111-4111-8111-111111111111') }));
afterEach(() => { cleanup(); mutatingFetch.mockReset(); vi.unstubAllGlobals(); });

describe('OrderPaymentsCard', () => {
  it('renders a responsive Ukrainian summary and retained history without a table dependency', () => {
    const { container } = renderCard();
    expect(screen.getAllByText('Частково оплачено')).toHaveLength(2);
    expect(screen.getByText(/600,00/)).toBeInTheDocument();
    expect(screen.getByText('Аванс')).toBeInTheDocument();
    expect(container.querySelector('table')).not.toBeInTheDocument();
  });

  it('renders English status and explains unavailable pricing', () => {
    renderCard({ initial: null, accounts: [] }, 'en');
    expect(screen.getByText('Payment facts')).toBeInTheDocument();
    expect(screen.getByText(/Calculate and save the order total first/)).toBeInTheDocument();
  });

  it('shows method-specific controls and updates only local card state after recording', async () => {
    const changed = vi.fn();
    const paid = { ...summary, paidAmount: '1000.00', remainingAmount: '0.00', status: 'PAID' as const };
    mutatingFetch.mockResolvedValue(new Response(JSON.stringify(paid), { status: 200 }));
    renderCard({ onChange: changed });

    fireEvent.change(screen.getByLabelText('Спосіб оплати'), { target: { value: 'CASH_ON_DELIVERY' } });
    expect(screen.getByLabelText('Перевізник')).toBeInTheDocument();
    expect(screen.queryByLabelText('Рахунок для оплати')).not.toBeInTheDocument();
    fireEvent.submit(screen.getByRole('form', { name: 'Додати факт оплати' }));

    await waitFor(() => expect(changed).toHaveBeenCalledWith(paid));
    expect(screen.getAllByText('Оплачено')).toHaveLength(2);
    expect(mutatingFetch).toHaveBeenCalledWith('/api/orders/order-1/payments', expect.objectContaining({ method: 'POST' }));
  });

  it('keeps an API error visible and stops the pending state', async () => {
    mutatingFetch.mockResolvedValue(new Response(JSON.stringify({ message: 'Payment rejected' }), { status: 409 }));
    renderCard();
    fireEvent.submit(screen.getByRole('form', { name: 'Додати факт оплати' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Payment rejected');
    expect(screen.getByRole('button', { name: 'Зафіксувати оплату' })).not.toBeDisabled();
  });

  it('allows only an owner to open the cancellation form and keeps cancelled rows visible', async () => {
    const cancelled = { ...summary, paidAmount: '0.00', remainingAmount: '1000.00', status: 'UNPAID' as const, payments: [{ ...summary.payments[0]!, cancelledAt: '2026-09-21T10:00:00.000Z', cancellationReason: 'Помилковий запис', cancelledBy: { id: 'owner-1', name: 'Власник' } }] };
    mutatingFetch.mockResolvedValue(new Response(JSON.stringify(cancelled), { status: 200 }));
    const changed = vi.fn();
    renderCard({ onChange: changed });
    fireEvent.click(screen.getByRole('button', { name: 'Скасувати оплату' }));
    expect(screen.getByRole('button', { name: 'Скасувати' })).toHaveClass('secondary-button');
    fireEvent.change(screen.getByLabelText('Причина скасування'), { target: { value: 'Помилковий запис' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Скасувати оплату' }));
    await waitFor(() => expect(changed).toHaveBeenCalledWith(cancelled));
    expect(screen.getByText(/Помилковий запис/)).toBeInTheDocument();

    cleanup();
    renderCard({ role: 'MANAGER' });
    expect(screen.queryByRole('button', { name: 'Скасувати оплату' })).not.toBeInTheDocument();
  });
});
