import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RouteSkeleton } from './route-skeleton';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('RouteSkeleton', () => {
  it.each([
    ['orders', 'table', 'Замовлення', 'Завантажуємо список замовлень…'],
    ['catalogue', 'table', 'Каталог товарів', 'Завантажуємо каталог…'],
    ['team', 'table', 'Команда', 'Завантажуємо команду…'],
    ['settings', 'settings', 'Налаштування', 'Завантажуємо налаштування…'],
    ['conversations', 'conversation', 'Діалоги', 'Завантажуємо діалоги…'],
    ['orderDetail', 'detail', 'Замовлення', 'Завантажуємо замовлення…'],
    ['dashboard', 'dashboard', 'Операційний огляд', 'Завантажуємо показники…'],
  ] as const)('renders a contextual %s loading state', (section, variant, title, message) => {
    const { container } = render(<RouteSkeleton section={section} variant={variant} />);
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(message);
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(container.querySelectorAll('button, a, input')).toHaveLength(0);
    expect(container.querySelector(`[data-variant="${variant}"]`)).toBeInTheDocument();
  });

  it('changes to an honest long-wait message without inventing progress and cleans up its timer', () => {
    vi.useFakeTimers();
    const { unmount } = render(<RouteSkeleton section="orders" variant="table" />);
    act(() => vi.advanceTimersByTime(2999));
    expect(screen.getByRole('status')).toHaveTextContent('Завантажуємо список замовлень…');
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('status')).toHaveTextContent('Це займає довше, ніж зазвичай. Зачекайте ще трохи.');
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
