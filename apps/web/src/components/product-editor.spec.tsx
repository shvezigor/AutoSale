import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProductEditor } from './product-editor';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); refresh.mockReset(); });

describe('ProductEditor', () => {
  it('edits aliases and saves an existing product with csrf protection', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf-token' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(<ProductEditor product={{
      id: 'b6c1a440-a39d-41d1-b9c2-ebdac84d4c48',
      sku: 'LUNA-01',
      name: 'Сукня Luna',
      description: null,
      price: 2499,
      currency: 'uah',
      stockQuantity: 7,
      category: null,
      brand: null,
      aliases: ['luna'],
      color: null,
      size: null,
      imageUrls: ['https://example.com/luna.jpg'],
      attributes: { season: 'summer' },
      sourceId: '0ef24563-a181-4d36-b2c7-e457f5d3ece3',
      sourceRowKey: 'row-42',
      sourceUpdatedAt: '2026-08-31T09:00:00.000Z',
      createdAt: '2026-08-30T09:00:00.000Z',
      updatedAt: '2026-08-31T09:00:00.000Z',
      active: true,
    }} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Аліаси'), { target: { value: 'luna, літня сукня' } });
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти зміни' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/catalogue/b6c1a440-a39d-41d1-b9c2-ebdac84d4c48',
      expect.objectContaining({ method: 'PATCH', headers: expect.objectContaining({ 'content-type': 'application/json', 'x-csrf-token': 'csrf-token' }) }),
    ));
    const request = fetchMock.mock.calls.find(([path]) => path === '/api/catalogue/b6c1a440-a39d-41d1-b9c2-ebdac84d4c48')?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual(expect.objectContaining({
      aliases: ['luna', 'літня сукня'],
      imageUrls: ['https://example.com/luna.jpg'],
      attributes: { season: 'summer' },
      currency: 'UAH',
    }));
    expect(JSON.parse(String(request.body))).not.toEqual(expect.objectContaining({
      id: expect.any(String),
      sourceId: expect.any(String),
      sourceRowKey: expect.any(String),
      sourceUpdatedAt: expect.any(String),
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    }));
    expect(screen.getByRole('status')).toHaveTextContent('Зміни збережено');
    expect(refresh).toHaveBeenCalled();
  });

  it('shows a safe error message when saving fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf-token' }) })
      .mockResolvedValueOnce({ ok: false });
    vi.stubGlobal('fetch', fetchMock);
    render(<ProductEditor onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Артикул'), { target: { value: 'LUNA-01' } });
    fireEvent.change(screen.getByLabelText('Назва товару'), { target: { value: 'Сукня Luna' } });
    fireEvent.click(screen.getByRole('button', { name: 'Додати товар' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Не вдалося зберегти товар. Спробуйте ще раз.'));
  });

  it('recovers to a safe error message after a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection reset by peer')));
    render(<ProductEditor onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Артикул'), { target: { value: 'LUNA-01' } });
    fireEvent.change(screen.getByLabelText('Назва товару'), { target: { value: 'Сукня Luna' } });
    fireEvent.click(screen.getByRole('button', { name: 'Додати товар' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Не вдалося зберегти товар. Спробуйте ще раз.'));
  });
});
