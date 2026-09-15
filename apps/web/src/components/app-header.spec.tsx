import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../i18n/i18n-provider';
import { AppHeader } from './app-header';
import { ToastProvider } from './toast-provider';

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

function renderHeader(session: Parameters<typeof AppHeader>[0]['session']) {
  return render(<I18nProvider locale="uk" authenticated><ToastProvider><AppHeader session={session} /></ToastProvider></I18nProvider>);
}

describe('AppHeader', () => {
  it('shows unread notifications and owner profile actions', async () => {
    renderHeader({ name: 'Ігор Швець', email: 'owner@example.com', membershipRole: 'OWNER', avatarUrl: '/api/media/profile/avatar?v=abc' });
    const bell = await screen.findByRole('button', { name: 'Сповіщення: 1 непрочитаних' });
    fireEvent.click(bell);
    expect(screen.getByText('Каталог готовий')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Меню профілю' }));
    expect(screen.getByRole('menuitem', { name: 'Мій профіль' })).toHaveAttribute('href', '/profile');
    expect(screen.queryByRole('menuitem', { name: 'Налаштування' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Команда' })).toHaveAttribute('href', '/team');
    expect(screen.getByRole('img', { name: 'Фото профілю Ігор Швець' })).toHaveAttribute('src', '/api/media/profile/avatar?v=abc');
  });

  it('hides team from managers and closes with Escape', async () => {
    renderHeader({ name: 'Олена', email: 'manager@example.com', membershipRole: 'MANAGER', avatarUrl: null });
    await waitFor(() => expect(screen.getByRole('button', { name: /Сповіщення/ })).toBeInTheDocument());
    const profile = screen.getByRole('button', { name: 'Меню профілю' });
    fireEvent.click(profile);
    expect(screen.queryByRole('menuitem', { name: 'Команда' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Ініціал О')).toHaveTextContent('О');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(profile).toHaveFocus();
  });
});
