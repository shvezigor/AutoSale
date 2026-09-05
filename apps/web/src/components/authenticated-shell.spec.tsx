import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthenticatedShell } from './authenticated-shell';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('AuthenticatedShell', () => {
  it('renders navigation, header, and content once', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    render(<AuthenticatedShell active="orders" session={{ name: 'Ігор', email: 'owner@example.com', membershipRole: 'OWNER' }}><h1>Замовлення</h1></AuthenticatedShell>);
    expect(screen.getByRole('link', { name: 'AutoSale' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Меню профілю' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Замовлення' })).toBeInTheDocument();
  });

  it('opens and closes an accessible mobile navigation drawer', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    render(<AuthenticatedShell active="orders" session={{ name: 'Ігор', email: 'owner@example.com', membershipRole: 'OWNER' }}><h1>Замовлення</h1></AuthenticatedShell>);
    const trigger = screen.getByRole('button', { name: 'Відкрити меню' });
    fireEvent.click(trigger);
    expect(screen.getByRole('navigation', { name: 'Мобільна навігація' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('navigation', { name: 'Мобільна навігація' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
