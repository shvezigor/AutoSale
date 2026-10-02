import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../i18n/i18n-provider';
import { WorkspaceSearch } from './workspace-search';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const result = {
  query: 'Ол',
  customers: [{ key: 'phone:0970000000', name: 'Олена', context: '0970000000', href: '/orders?search=0970000000' }],
  orders: [{ id: 'b46c9029-ecdd-4fa5-8c0a-e3146ffe3168', publicNumber: 'SA-261002', customerName: 'Олена', productSummary: 'Двері', status: 'APPROVED', href: '/orders/b46c9029-ecdd-4fa5-8c0a-e3146ffe3168' }],
  products: [{ id: 'e46c9029-ecdd-4fa5-8c0a-e3146ffe3168', sku: 'AUTO-1', name: 'Двері', price: 3700, currency: 'UAH', stockQuantity: 7, href: '/catalogue?search=AUTO-1' }],
};

beforeEach(() => {
  vi.useFakeTimers();
  push.mockReset();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => result }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('WorkspaceSearch', () => {
  it('opens from its trigger and searches only after two characters', async () => {
    renderSearch();
    fireEvent.click(screen.getByRole('button', { name: 'Глобальний пошук' }));
    const input = screen.getByRole('combobox', { name: 'Глобальний пошук' });
    expect(input).toHaveFocus();

    fireEvent.change(input, { target: { value: 'О' } });
    await advance();
    expect(fetch).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'Ол' } });
    await advance();
    expect(fetch).toHaveBeenCalledWith('/api/search?q=%D0%9E%D0%BB&limit=5', expect.objectContaining({ cache: 'no-store' }));
    expect(screen.getByRole('heading', { name: 'Клієнти' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Олена.*0970000000/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Замовлення' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Товари' })).toBeInTheDocument();
  });

  it('opens with Ctrl+K and supports ArrowDown, Enter and Escape', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true, status: 200, json: async () => ({ ...result, customers: [], products: [] }),
    } as Response);
    renderSearch();
    const trigger = screen.getByRole('button', { name: 'Глобальний пошук' });

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    const input = screen.getByRole('combobox', { name: 'Глобальний пошук' });
    fireEvent.change(input, { target: { value: 'AS' } });
    await advance();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(push).toHaveBeenCalledWith('/orders/b46c9029-ecdd-4fa5-8c0a-e3146ffe3168');

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('aborts a stale request when the query changes', async () => {
    const signals: AbortSignal[] = [];
    vi.mocked(fetch).mockImplementation((_url, init) => {
      signals.push(init?.signal as AbortSignal);
      return new Promise(() => undefined);
    });
    renderSearch();
    fireEvent.click(screen.getByRole('button', { name: 'Глобальний пошук' }));
    const input = screen.getByRole('combobox', { name: 'Глобальний пошук' });
    fireEvent.change(input, { target: { value: 'Ол' } });
    await advance();
    fireEvent.change(input, { target: { value: 'Дв' } });
    await advance();

    expect(signals).toHaveLength(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });

  it('distinguishes retryable errors from an empty result', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ query: 'ZZ', customers: [], orders: [], products: [] }) } as Response);
    renderSearch();
    fireEvent.click(screen.getByRole('button', { name: 'Глобальний пошук' }));
    const input = screen.getByRole('combobox', { name: 'Глобальний пошук' });
    fireEvent.change(input, { target: { value: 'ZZ' } });
    await advance();

    expect(screen.getByRole('alert')).toHaveTextContent('Не вдалося виконати пошук');
    fireEvent.click(screen.getByRole('button', { name: 'Спробувати ще раз' }));
    await advance();
    expect(screen.getByText('Нічого не знайдено')).toBeInTheDocument();
  });

  it('renders English search guidance', () => {
    renderSearch('en');
    fireEvent.click(screen.getByRole('button', { name: 'Global search' }));
    expect(screen.getByRole('combobox', { name: 'Global search' })).toBeInTheDocument();
    expect(screen.getByText('Enter at least 2 characters')).toBeInTheDocument();
  });
});

function renderSearch(locale: 'uk' | 'en' = 'uk') {
  return render(<I18nProvider locale={locale} authenticated><WorkspaceSearch /></I18nProvider>);
}

async function advance() {
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
}
