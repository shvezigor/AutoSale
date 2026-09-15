import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mutatingFetch, refresh } = vi.hoisted(() => ({ mutatingFetch: vi.fn(), refresh: vi.fn() }));
vi.mock('../auth/csrf-fetch', () => ({ mutatingFetch }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { I18nProvider } from '../i18n/i18n-provider';
import { LocaleSwitcher } from './locale-switcher';
import { ToastProvider } from './toast-provider';

function renderSwitcher(authenticated = false, variant: 'header' | 'profile' = 'header') {
  return render(<I18nProvider locale="uk" authenticated={authenticated}><ToastProvider><LocaleSwitcher variant={variant} /></ToastProvider></I18nProvider>);
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  mutatingFetch.mockReset();
  refresh.mockReset();
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('LocaleSwitcher', () => {
  it('exposes a compact, accessible UA/EN switch and confirms the change', async () => {
    renderSwitcher();
    const group = screen.getByRole('group', { name: 'Мова інтерфейсу' });
    expect(group).toHaveClass('locale-switcher-header');
    expect(screen.getByRole('button', { name: 'Українська' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'English' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true'));
    expect(await screen.findByText('Interface language changed')).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('shows full language names in the profile variant', () => {
    renderSwitcher(false, 'profile');
    expect(screen.getByRole('group', { name: 'Мова інтерфейсу' })).toHaveClass('locale-switcher-profile');
    expect(screen.getByRole('button', { name: 'Українська' })).toHaveTextContent('Українська');
    expect(screen.getByRole('button', { name: 'English' })).toHaveTextContent('English');
  });

  it('restores the selected language and reports a persistence failure', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 500 }));
    renderSwitcher(true);

    fireEvent.click(screen.getByRole('button', { name: 'English' }));

    expect(await screen.findByText('Не вдалося змінити мову')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Українська' })).toHaveAttribute('aria-pressed', 'true');
    expect(refresh).not.toHaveBeenCalled();
  });
});
