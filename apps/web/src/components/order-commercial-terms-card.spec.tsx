import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OrderCommercialTermsSummary } from '../../../../packages/contracts/src/commercial';
import { I18nProvider } from '../i18n/i18n-provider';
import { OrderCommercialTermsCard } from './order-commercial-terms-card';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const { mutatingFetch } = vi.hoisted(() => ({ mutatingFetch: vi.fn() }));
vi.mock('../auth/csrf-fetch', () => ({ mutatingFetch }));

const ready: OrderCommercialTermsSummary = {
  pricingStatus: 'READY', issueCodes: [], currency: 'UAH', itemsSubtotal: '1299.00', discountAmount: '0.00', deliveryAmount: '0.00', totalAmount: '1299.00',
  legalEntity: { id: 'entity-1', displayName: 'AutoSale', legalName: 'ТОВ Авто Сейл', type: 'COMPANY', registrationId: '12345678', active: true, isDefault: true },
  bankAccount: { id: 'account-1', legalEntityId: 'entity-1', label: 'UAH основний', maskedIban: 'UA••••0000', bankName: 'Тест Банк', currency: 'UAH', active: true, isDefault: true },
  eligibleAccounts: [{ id: 'account-1', legalEntityId: 'entity-1', label: 'UAH основний', maskedIban: 'UA••••0000', bankName: 'Тест Банк', currency: 'UAH', active: true, isDefault: true }], version: 1, legacy: false,
};

afterEach(() => { cleanup(); mutatingFetch.mockReset(); });

describe('OrderCommercialTermsCard', () => {
  it('shows the expected amount and explains it is not a received payment', () => {
    render(<I18nProvider locale="uk" authenticated={false}><OrderCommercialTermsCard orderId="order-1" initial={ready} locked={false} onChange={vi.fn()} /></I18nProvider>);
    expect(screen.getByText(/1\s299,00/)).toBeInTheDocument();
    expect(screen.getByText('Сума до сплати — не підтвердження отримання коштів.')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /UAH основний.*UA/ })).toBeInTheDocument();
  });

  it('previews a legacy order without writing, then initializes it explicitly', async () => {
    const preview = { ...ready, version: 0, legacy: true };
    const changed = vi.fn();
    mutatingFetch
      .mockResolvedValueOnce(new Response(JSON.stringify(preview), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(ready), { status: 200 }));
    render(<I18nProvider locale="uk" authenticated={false}><OrderCommercialTermsCard orderId="order-1" initial={null} locked={false} onChange={changed} /></I18nProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Розрахувати суму' }));
    expect(await screen.findByRole('button', { name: 'Зберегти розрахунок' })).toBeInTheDocument();
    expect(mutatingFetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти розрахунок' }));
    await waitFor(() => expect(changed).toHaveBeenCalledWith(ready));
    expect(JSON.parse(mutatingFetch.mock.calls[1]![1].body)).toMatchObject({ version: 0, initializeLegacy: true, legalEntityId: 'entity-1', bankAccountId: 'account-1' });
  });

  it('shows concrete pricing issues and prevents edits after fulfilment starts', () => {
    render(<OrderCommercialTermsCard orderId="order-1" initial={{ ...ready, pricingStatus: 'NEEDS_REVIEW', totalAmount: null, issueCodes: ['ITEM_PRICE_MISSING'] }} locked onChange={vi.fn()} />);
    expect(screen.getByText('Для одного або кількох товарів не вказана ціна.')).toBeInTheDocument();
    expect(screen.getByLabelText('Рахунок для оплати')).toBeDisabled();
    expect(screen.getByText(/виконання замовлення вже розпочато/)).toBeInTheDocument();
  });

  it('explains a version conflict and stops the save loader', async () => {
    mutatingFetch.mockResolvedValue(new Response(null, { status: 409 }));
    render(<OrderCommercialTermsCard orderId="order-1" initial={ready} locked={false} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти реквізити' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Оновіть сторінку/);
    expect(screen.getByRole('button', { name: 'Зберегти реквізити' })).not.toBeDisabled();
  });
});
