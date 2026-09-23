import { cleanup, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProductEditor } from './product-editor';
import { ActivityProvider } from './activity-provider';
import { ToastProvider } from './toast-provider';
import { I18nProvider } from '../i18n/i18n-provider';

function render(ui: React.ReactElement) { return rtlRender(<ToastProvider><ActivityProvider>{ui}</ActivityProvider></ToastProvider>); }
function renderEnglish(ui: React.ReactElement) { return rtlRender(<I18nProvider locale="en" authenticated><ToastProvider><ActivityProvider>{ui}</ActivityProvider></ToastProvider></I18nProvider>); }

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); refresh.mockReset(); });

describe('ProductEditor', () => {
  it('shows required SKU and name errors below the fields and focuses SKU without saving', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<ProductEditor onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Додати товар' }));

    expect(screen.getByLabelText('Артикул')).toHaveFocus();
    expect(screen.getByLabelText('Артикул')).toHaveAttribute('aria-describedby', 'product-sku-error');
    expect(screen.getByLabelText('Назва товару')).toHaveAttribute('aria-describedby', 'product-name-error');
    expect(screen.getAllByText('Заповніть це поле.')).toHaveLength(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('attaches duplicate aliases to the aliases field and does not save', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<ProductEditor onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Артикул'), { target: { value: 'LUNA-01' } });
    fireEvent.change(screen.getByLabelText('Назва товару'), { target: { value: 'Сукня Luna' } });
    fireEvent.change(screen.getByLabelText('Аліаси'), { target: { value: 'luna, luna' } });
    fireEvent.click(screen.getByRole('button', { name: 'Додати товар' }));

    expect(screen.getByLabelText('Аліаси')).toHaveFocus();
    expect(screen.getByLabelText('Аліаси')).toHaveAttribute('aria-describedby', expect.stringContaining('product-aliases-error'));
    expect(screen.getByText('Аліаси не мають повторюватися.')).toHaveAttribute('id', 'product-aliases-error');
    expect(fetchMock).not.toHaveBeenCalled();
  });

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
    expect(screen.getAllByRole('status').some((element) => element.textContent?.includes('Зміни збережено'))).toBe(true);
    expect(refresh).toHaveBeenCalled();
  });

  it('resets the form when another catalogue product is selected', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf-token' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const onClose = vi.fn();
    const firstProduct = {
      id: 'first-product', sku: 'FIRST-01', name: 'Перший товар', stockQuantity: 2, aliases: ['перший'],
    };
    const secondProduct = {
      id: 'second-product', sku: 'SECOND-02', name: 'Другий товар', stockQuantity: null, aliases: ['другий'],
    };

    const view = render(<ProductEditor onClose={onClose} product={firstProduct} />);
    view.rerender(<ToastProvider><ActivityProvider><ProductEditor onClose={onClose} product={secondProduct} /></ActivityProvider></ToastProvider>);

    expect(screen.getByLabelText('Артикул')).toHaveValue('SECOND-02');
    expect(screen.getByLabelText('Назва товару')).toHaveValue('Другий товар');
    expect(screen.getByLabelText('Аліаси')).toHaveValue('другий');
    fireEvent.change(screen.getByLabelText('Залишок'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти зміни' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/catalogue/second-product',
      expect.objectContaining({ method: 'PATCH' }),
    ));
    const request = fetchMock.mock.calls.find(([path]) => path === '/api/catalogue/second-product')?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual(expect.objectContaining({ sku: 'SECOND-02', stockQuantity: 8 }));
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

  it('puts a safe server SKU issue under the SKU field', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf-token' }) }).mockResolvedValueOnce(new Response(JSON.stringify({ statusCode: 400, code: 'VALIDATION_FAILED', issues: [{ field: 'sku', code: 'INVALID_SKU' }] }), { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<ProductEditor onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Артикул'), { target: { value: 'LUNA-01' } });
    fireEvent.change(screen.getByLabelText('Назва товару'), { target: { value: 'Сукня Luna' } });
    fireEvent.click(screen.getByRole('button', { name: 'Додати товар' }));
    await waitFor(() => expect(screen.getByText('Перевірте введене значення.')).toHaveAttribute('id', 'product-sku-error'));
    expect(screen.getByLabelText('Артикул')).toHaveFocus();
  });

  it('recovers to a safe error message after a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection reset by peer')));
    render(<ProductEditor onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Артикул'), { target: { value: 'LUNA-01' } });
    fireEvent.change(screen.getByLabelText('Назва товару'), { target: { value: 'Сукня Luna' } });
    fireEvent.click(screen.getByRole('button', { name: 'Додати товар' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Не вдалося зберегти товар. Спробуйте ще раз.'));
  });

  it('translates the editor without changing product values', () => {
    renderEnglish(<ProductEditor product={{ id: 'product-1', sku: 'LUNA-01', name: 'Сукня Luna', stockQuantity: 7 }} onClose={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Edit product' })).toBeInTheDocument();
    expect(screen.getByLabelText('SKU')).toHaveValue('LUNA-01');
    expect(screen.getByLabelText('Product name')).toHaveValue('Сукня Luna');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  });
});
