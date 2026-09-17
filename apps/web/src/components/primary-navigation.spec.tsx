import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../i18n/i18n-provider';
import { PrimaryNavigation } from './primary-navigation';

const { usePathname } = vi.hoisted(() => ({ usePathname: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname, useRouter: () => ({ refresh: vi.fn() }) }));

const managerSession = { name: 'Іван', email: 'manager@example.com', membershipRole: 'MANAGER' as const };
const ownerSession = { name: 'Олена', email: 'owner@example.com', membershipRole: 'OWNER' as const };

afterEach(() => { cleanup(); usePathname.mockReset(); });

function renderNavigation(session: Parameters<typeof PrimaryNavigation>[0]['session'] = ownerSession, locale: 'uk' | 'en' = 'uk', props: Partial<Parameters<typeof PrimaryNavigation>[0]> = {}) {
  return render(<I18nProvider locale={locale} authenticated><PrimaryNavigation session={session} {...props} /></I18nProvider>);
}

describe('PrimaryNavigation', () => {
  it('exposes the dashboard as the first workspace destination', () => {
    usePathname.mockReturnValue('/dashboard');
    renderNavigation();

    const links = screen.getAllByRole('link');
    expect(screen.getByRole('link', { name: 'Дашборд' })).toHaveAttribute('href', '/dashboard');
    expect(screen.getByRole('link', { name: 'Дашборд' })).toHaveAttribute('aria-current', 'page');
    expect(links.indexOf(screen.getByRole('link', { name: 'Дашборд' }))).toBeLessThan(
      links.indexOf(screen.getByRole('link', { name: 'Діалоги' })),
    );
  });

  it('shows settings but hides team management from managers', () => {
    usePathname.mockReturnValue('/orders');
    renderNavigation(managerSession);
    expect(screen.queryByRole('link', { name: 'Команда' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Налаштування' })).toHaveAttribute('href', '/settings');
    expect(screen.getByRole('link', { name: 'Каталог' })).toHaveAttribute('href', '/catalogue');
    expect(screen.getByRole('link', { name: 'Онбординг' })).toHaveAttribute('href', '/onboarding');
  });

  it('leaves profile actions to the application header', () => {
    usePathname.mockReturnValue('/conversations');
    renderNavigation();
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
    renderNavigation();

    expect(screen.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
  });

  it('keeps every destination named when the navigation is collapsed', () => {
    usePathname.mockReturnValue('/settings');
    renderNavigation(ownerSession, 'uk', { collapsed: true });

    expect(screen.getByRole('link', { name: 'Замовлення' })).toHaveAttribute('aria-label', 'Замовлення');
    expect(screen.getByRole('link', { name: 'Налаштування' })).toHaveAttribute('aria-current', 'page');
  });

  it('keeps the reference line icon mapped to every destination', () => {
    usePathname.mockReturnValue('/dashboard');
    renderNavigation();

    const expectedIcons = [
      ['Дашборд', 'dashboard'],
      ['Діалоги', 'conversations'],
      ['Замовлення', 'orders'],
      ['Каталог', 'catalogue'],
      ['Команда', 'team'],
      ['Налаштування', 'settings'],
      ['Онбординг', 'onboarding'],
    ] as const;

    for (const [label, icon] of expectedIcons) {
      expect(screen.getByRole('link', { name: label }).querySelector('svg')).toHaveAttribute('data-icon', icon);
    }
  });

  it('renders destinations and collapse actions in English', () => {
    usePathname.mockReturnValue('/orders');
    renderNavigation(ownerSession, 'en', { onToggleCollapse: vi.fn() });
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Conversations' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Orders' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Collapse menu' })).toBeInTheDocument();
  });
});
