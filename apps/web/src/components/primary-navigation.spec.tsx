import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../i18n/i18n-provider';
import { PrimaryNavigation } from './primary-navigation';
import { WorkspaceNavigationReady } from './workspace-navigation-timing';

const { usePathname, prefetch } = vi.hoisted(() => ({ usePathname: vi.fn(), prefetch: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname, useRouter: () => ({ refresh: vi.fn(), prefetch }) }));
vi.mock('next/link', () => ({
  default: ({ prefetch: shouldPrefetch, children, ...props }: { prefetch?: boolean; children?: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) =>
    <a {...props} data-prefetch={String(shouldPrefetch)} onClick={(event) => { props.onClick?.(event); event.preventDefault(); }}>{children}</a>,
}));

const managerSession = { name: 'Іван', email: 'manager@example.com', membershipRole: 'MANAGER' as const };
const ownerSession = { name: 'Олена', email: 'owner@example.com', membershipRole: 'OWNER' as const };

afterEach(() => { cleanup(); usePathname.mockReset(); prefetch.mockReset(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.sessionStorage.clear(); window.history.replaceState({}, '', '/dashboard'); });

function renderNavigation(session: Parameters<typeof PrimaryNavigation>[0]['session'] = ownerSession, locale: 'uk' | 'en' = 'uk', props: Partial<Parameters<typeof PrimaryNavigation>[0]> = {}) {
  return render(<I18nProvider locale={locale} authenticated><PrimaryNavigation session={session} {...props} /></I18nProvider>);
}

describe('PrimaryNavigation', () => {
  it('prefetches workspace destinations only when the user shows intent', () => {
    usePathname.mockReturnValue('/dashboard');
    renderNavigation();

    for (const link of screen.getAllByRole('link')) expect(link).toHaveAttribute('data-prefetch', 'false');
    expect(prefetch).not.toHaveBeenCalled();

    fireEvent.mouseEnter(screen.getByRole('link', { name: 'Дашборд' }));
    fireEvent.focus(screen.getByRole('link', { name: 'Sales AITO' }));
    expect(prefetch).not.toHaveBeenCalled();

    fireEvent.mouseEnter(screen.getByRole('link', { name: 'Замовлення' }));
    expect(prefetch).toHaveBeenCalledWith('/orders');

    fireEvent.focus(screen.getByRole('link', { name: 'Налаштування' }));
    expect(prefetch).toHaveBeenCalledWith('/settings');

    fireEvent.mouseEnter(screen.getByRole('link', { name: 'Замовлення' }));
    expect(prefetch).toHaveBeenCalledTimes(2);
  });

  it('records an opted-in sidebar click until the destination is ready without skipping mobile close', () => {
    window.history.replaceState({}, '', '/dashboard?navTiming=1');
    usePathname.mockReturnValue('/dashboard');
    const now = vi.spyOn(performance, 'now').mockReturnValue(300);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    let frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    const paintFrame = () => { const callbacks = frames; frames = []; callbacks.forEach((callback) => callback(0)); };
    const onNavigate = vi.fn();
    renderNavigation(ownerSession, 'uk', { onNavigate });

    fireEvent.click(screen.getByRole('link', { name: 'Замовлення' }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
    now.mockReturnValue(750);
    render(<WorkspaceNavigationReady route="orders" />);
    expect(info).not.toHaveBeenCalled();
    paintFrame();
    paintFrame();
    expect(info).toHaveBeenCalledExactlyOnceWith('workspace_navigation_ready {"route":"orders","durationMs":450,"readyEffectMs":450,"routeResourceCount":0,"effectToPaintMs":0}');
  });

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
