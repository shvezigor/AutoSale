import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthenticatedShell } from './authenticated-shell';

vi.mock('next/navigation', () => ({ usePathname: () => '/orders', useRouter: () => ({ refresh: vi.fn() }) }));

const ownerSession = { name: 'Ігор', email: 'owner@example.com', membershipRole: 'OWNER' as const };

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.sidebarState;
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('AuthenticatedShell', () => {
  it('renders navigation, header, and content once', () => {
    render(<AuthenticatedShell session={ownerSession}><h1>Замовлення</h1></AuthenticatedShell>);
    expect(screen.getByRole('link', { name: 'AutoSale' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Меню профілю' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Замовлення' })).toBeInTheDocument();
  });

  it('opens and closes an accessible mobile navigation drawer', () => {
    render(<AuthenticatedShell session={ownerSession}><h1>Замовлення</h1></AuthenticatedShell>);
    const trigger = screen.getByRole('button', { name: 'Відкрити меню' });
    fireEvent.click(trigger);
    expect(screen.getByRole('navigation', { name: 'Мобільна навігація' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('navigation', { name: 'Мобільна навігація' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('starts expanded and persists a desktop collapse preference', () => {
    render(<AuthenticatedShell session={ownerSession}><h1>Замовлення</h1></AuthenticatedShell>);

    const toggle = screen.getByRole('button', { name: 'Згорнути меню' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);

    expect(screen.getByRole('button', { name: 'Розгорнути меню' })).toHaveAttribute('aria-expanded', 'false');
    expect(document.documentElement).toHaveAttribute('data-sidebar-state', 'collapsed');
    expect(localStorage.getItem('autosale.sidebar')).toBe('collapsed');
  });

  it('restores a valid saved collapse preference', () => {
    localStorage.setItem('autosale.sidebar', 'collapsed');
    document.documentElement.dataset.sidebarState = 'collapsed';

    render(<AuthenticatedShell session={ownerSession}><h1>Замовлення</h1></AuthenticatedShell>);

    expect(screen.getByRole('button', { name: 'Розгорнути меню' })).toHaveAttribute('aria-expanded', 'false');
  });
});
