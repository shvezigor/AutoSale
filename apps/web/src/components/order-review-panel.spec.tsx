import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagerOrder } from '../../../../packages/contracts/src/orders';

import { OrderReviewPanel } from './order-review-panel';

const order: ManagerOrder = {
  id: '11111111-1111-4111-8111-111111111111',
  status: 'NEEDS_REVIEW',
  participantName: 'Олена',
  channel: 'INSTAGRAM',
  overallConfidence: 0.82,
  validationIssues: [],
  customer: { name: 'Олена', phone: '+380671234567', instagramUsername: 'olena' },
  delivery: { city: 'Київ', address: null, novaPoshtaBranch: '24' },
  items: [{ id: 'item-1', catalogId: 'UB-038-BLK', productName: 'Кросівки Urban Black', originalText: 'чорна модель 38', quantity: 1, color: 'Чорний', size: '38', confidence: 0.82 }],
  catalogueCandidates: [{ sku: 'UB-038-BLK', name: 'Кросівки Urban Black' }],
  createdAt: '2026-08-26T12:00:00.000Z',
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('OrderReviewPanel', () => {
  it('approves a complete order and shows the new status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...order, status: 'APPROVED' }) }));
    render(<OrderReviewPanel initialOrder={order} />);

    fireEvent.click(screen.getByRole('button', { name: 'Підтвердити' }));

    await waitFor(() => expect(screen.getByText('Підтверджено')).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith(`/api/orders/${order.id}/approve`, expect.objectContaining({ method: 'POST' }));
  });

  it('does not allow approval when validation issues remain', () => {
    render(<OrderReviewPanel initialOrder={{ ...order, validationIssues: ['customer.phone'] }} />);
    expect(screen.getByRole('button', { name: 'Підтвердити' })).toBeDisabled();
    expect(screen.getByText('Потрібно заповнити: customer.phone')).toBeInTheDocument();
  });

  it('saves manager corrections before approval', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...order, customer: { ...order.customer, phone: '+380501112233' } }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<OrderReviewPanel initialOrder={order} />);
    fireEvent.change(screen.getByLabelText('Телефон'), { target: { value: '+380501112233' } });
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти зміни' }));
    await waitFor(() => expect(screen.getByText('Зміни збережено')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(`/api/orders/${order.id}`, expect.objectContaining({ method: 'PATCH' }));
  });
});
