import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PrimaryNavigation } from './primary-navigation';

const { usePathname } = vi.hoisted(() => ({ usePathname: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname }));

const managerSession = { name: 'Іван', email: 'manager@example.com', membershipRole: 'MANAGER' as const };
const ownerSession = { name: 'Олена', email: 'owner@example.com', membershipRole: 'OWNER' as const };

afterEach(() => { cleanup(); usePathname.mockReset(); });

describe('PrimaryNavigation', () => {
  it('shows settings but hides team management from managers', () => {
    usePathname.mockReturnValue('/orders');
    render(<PrimaryNavigation session={managerSession} />);
    expect(screen.queryByRole('link', { name: 'Команда' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Налаштування' })).toHaveAttribute('href', '/settings');
    expect(screen.getByRole('link', { name: 'Каталог' })).toHaveAttribute('href', '/catalogue');
  });

  it('leaves profile actions to the application header', () => {
    usePathname.mockReturnValue('/conversations');
    render(<PrimaryNavigation session={ownerSession} />);
    expect(screen.queryByRole('button', { name: 'Вийти' })).not.toBeInTheDocument();
    expect(screen.queryByText('Власник')).not.toBeInTheDocument();
  });

  it.each([
    ['/orders', 'Замовлення'],
    ['/orders/123', 'Замовлення'],
    ['/catalogue', 'Каталог'],
    ['/conversations/456', 'Діалоги'],
  ])('marks %s as the current section', (pathname, label) => {
    usePathname.mockReturnValue(pathname);
    render(<PrimaryNavigation session={ownerSession} />);

    expect(screen.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
  });

  it('keeps every destination named when the navigation is collapsed', () => {
    usePathname.mockReturnValue('/settings');
    render(<PrimaryNavigation session={ownerSession} collapsed />);

    expect(screen.getByRole('link', { name: 'Замовлення' })).toHaveAttribute('aria-label', 'Замовлення');
    expect(screen.getByRole('link', { name: 'Налаштування' })).toHaveAttribute('aria-current', 'page');
  });
});
