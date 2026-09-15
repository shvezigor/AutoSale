import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mutatingFetch, refresh } = vi.hoisted(() => ({ mutatingFetch: vi.fn(), refresh: vi.fn() }));
vi.mock('../auth/csrf-fetch', () => ({ mutatingFetch }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { LOCALE_COOKIE } from './locales';
import { I18nProvider, useI18n } from './i18n-provider';

let changeLocale: ReturnType<typeof useI18n>['setLocale'];

function Probe() {
  const i18n = useI18n();
  changeLocale = i18n.setLocale;
  return (
    <div>
      <span data-testid="locale">{i18n.locale}</span>
      <span>{i18n.t('common.greeting', { name: 'Ihor' })}</span>
      <span data-testid="number">{i18n.formatNumber(1234.5)}</span>
      <span data-testid="date">{i18n.formatDate('2026-09-15T21:30:00.000Z', { dateStyle: 'medium' })}</span>
    </div>
  );
}

function renderProvider(locale: 'uk' | 'en' = 'uk', authenticated = false) {
  return render(<I18nProvider locale={locale} authenticated={authenticated}><Probe /></I18nProvider>);
}

describe('I18nProvider', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    refresh.mockReset();
    mutatingFetch.mockReset();
    document.cookie = `${LOCALE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders translated copy and locale-aware values without a hydration-language swap', () => {
    renderProvider('en');
    expect(screen.getByTestId('locale')).toHaveTextContent('en');
    expect(screen.getByText('Hello, Ihor')).toBeInTheDocument();
    expect(screen.getByTestId('number')).toHaveTextContent('1,234.5');
    expect(screen.getByTestId('date')).toHaveTextContent('Sep 16, 2026');
  });

  it('persists an anonymous language choice in a cookie and refreshes server content', async () => {
    renderProvider('uk');
    await act(() => changeLocale('en'));

    expect(screen.getByTestId('locale')).toHaveTextContent('en');
    expect(document.cookie).toContain(`${LOCALE_COOKIE}=en`);
    expect(refresh).toHaveBeenCalledOnce();
    expect(mutatingFetch).not.toHaveBeenCalled();
  });

  it('persists an authenticated language choice in the user profile', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      name: 'Ігор Швець', phone: '+380501112233', locale: 'uk',
    }), { status: 200 }));
    mutatingFetch.mockResolvedValue(new Response(JSON.stringify({ locale: 'en' }), { status: 200 }));
    renderProvider('uk', true);

    await act(() => changeLocale('en'));

    expect(fetch).toHaveBeenCalledWith('/api/profile', expect.objectContaining({ cache: 'no-store' }));
    expect(mutatingFetch).toHaveBeenCalledWith('/api/profile', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ name: 'Ігор Швець', phone: '+380501112233', locale: 'en' }),
    }));
    expect(document.cookie).toContain(`${LOCALE_COOKIE}=en`);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('rolls back an optimistic language change when profile persistence fails', async () => {
    document.cookie = `${LOCALE_COOKIE}=uk; Path=/; Max-Age=31536000; SameSite=Lax`;
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      name: 'Ігор Швець', phone: null, locale: 'uk',
    }), { status: 200 }));
    mutatingFetch.mockResolvedValue(new Response(null, { status: 500 }));
    renderProvider('uk', true);

    await expect(act(() => changeLocale('en'))).rejects.toThrow('locale_update_failed');

    expect(screen.getByTestId('locale')).toHaveTextContent('uk');
    expect(document.cookie).toContain(`${LOCALE_COOKIE}=uk`);
    expect(refresh).not.toHaveBeenCalled();
  });
});
