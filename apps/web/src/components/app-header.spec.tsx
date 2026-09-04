import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppHeader } from './app-header';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/notifications?limit=20') return { ok: true, json: async () => ({ items: [{ id: 'n1', type: 'SUCCESS', category: 'TEST', title: 'Каталог готовий', message: null, actionUrl: '/catalogue', readAt: null, createdAt: new Date().toISOString() }], unreadCount: 1 }) };
    if (url === '/api/auth/csrf') return { ok: true, json: async () => ({ token: 'csrf' }) };
    return { ok: true, json: async () => ({}) };
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); refresh.mockClear(); });

describe('AppHeader', () => {
  it('shows unread notifications and owner profile actions', async () => {
    render(<AppHeader session={{ name: 'Ігор', email: 'owner@example.com', membershipRole: 'OWNER' }} />);
    const bell = await screen.findByRole('button', { name: 'Сповіщення: 1 непрочитаних' });
    fireEvent.click(bell);
    expect(screen.getByText('Каталог готовий')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Меню профілю' }));
    expect(screen.getByRole('menuitem', { name: 'Команда' })).toHaveAttribute('href', '/team');
  });

  it('hides team from managers and closes with Escape', async () => {
    render(<AppHeader session={{ name: 'Олена', email: 'manager@example.com', membershipRole: 'MANAGER' }} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Сповіщення/ })).toBeInTheDocument());
    const profile = screen.getByRole('button', { name: 'Меню профілю' });
    fireEvent.click(profile);
    expect(screen.queryByRole('menuitem', { name: 'Команда' })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(profile).toHaveFocus();
  });
});
