import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ManagerOrder } from '../../../../packages/contracts/src/orders';
import { ActivityProvider } from './activity-provider';
import { ProcurementItemCard } from './procurement-item-card';
import { ToastProvider } from './toast-provider';

const item: ManagerOrder['items'][number] = {
  id: '22222222-2222-4222-8222-222222222222',
  catalogId: 'SKU-1',
  productName: 'Двері Авангард',
  originalText: 'двері 860x2050',
  quantity: 1,
  color: null,
  size: '860x2050',
  confidence: 0.95,
  procurementStatus: 'IN_STOCK',
  procurementSource: 'AUTO',
  procurementReason: 'STOCK_AVAILABLE',
  stockAtDecision: 8,
  availableAtDecision: 6,
  reservation: { id: 'reservation-1', quantity: 1, status: 'ACTIVE' },
};

function renderCard(overrides: Partial<typeof item> = {}, onOrderChange = vi.fn()) {
  return {
    onOrderChange,
    ...render(<ToastProvider><ActivityProvider><ProcurementItemCard
      item={{ ...item, ...overrides }}
      orderId="11111111-1111-4111-8111-111111111111"
      onOrderChange={onOrderChange}
    /></ActivityProvider></ToastProvider>),
  };
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('ProcurementItemCard', () => {
  it('explains known and unknown stock in plain language', () => {
    const view = renderCard();
    expect(screen.getByText('Є на складі')).toBeInTheDocument();
    expect(screen.getByText('Доступно 6 із 8 од. · зарезервовано 1')).toBeInTheDocument();

    view.rerender(<ToastProvider><ActivityProvider><ProcurementItemCard
      item={{ ...item, procurementStatus: 'TO_ORDER', procurementReason: 'STOCK_UNKNOWN', stockAtDecision: null, availableAtDecision: null, reservation: null }}
      orderId="11111111-1111-4111-8111-111111111111"
      onOrderChange={vi.fn()}
    /></ActivityProvider></ToastProvider>);
    expect(screen.getByText('Потрібно замовити')).toBeInTheDocument();
    expect(screen.getByText('Залишок товару не вказано')).toBeInTheDocument();
  });

  it('updates the exact order item, keeps a stable pending button, and reports success globally', async () => {
    let finish!: (value: { ok: boolean; json: () => Promise<unknown> }) => void;
    const pending = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => { finish = resolve; });
    const nextOrder = { id: '11111111-1111-4111-8111-111111111111', procurementSummary: 'NEEDS_ORDER' };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf-token' }) })
      .mockReturnValueOnce(pending);
    vi.stubGlobal('fetch', fetchMock);
    const onOrderChange = vi.fn();
    renderCard({}, onOrderChange);

    fireEvent.click(screen.getByRole('button', { name: 'Замовити у постачальника' }));

    const button = await screen.findByRole('button', { name: 'Змінюємо…' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveClass('procurement-action');
    finish({ ok: true, json: async () => nextOrder });

    await waitFor(() => expect(onOrderChange).toHaveBeenCalledWith(nextOrder));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/orders/11111111-1111-4111-8111-111111111111/items/22222222-2222-4222-8222-222222222222/procurement',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ status: 'TO_ORDER' }) }),
    );
    expect(screen.getByText('Статус товару оновлено')).toBeInTheDocument();
  });

  it('locks manual changes while an item is being sent', () => {
    renderCard({ procurementStatus: 'SENDING' });
    expect(screen.getByText('Відправляється постачальнику')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Є на складі' })).not.toBeInTheDocument();
  });
});
