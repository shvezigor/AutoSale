'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';
import { LOCALE_COOKIE, type AppLocale } from './locales';
import { createTranslator, type Translator } from './translator';

const dateTimeLocales: Record<AppLocale, string> = { uk: 'uk-UA', en: 'en-US' };

type I18nContextValue = {
  locale: AppLocale;
  t: Translator;
  formatDate: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  setLocale: (locale: AppLocale) => Promise<void>;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function persistLocaleCookie(locale: AppLocale) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}

export function I18nProvider({
  children,
  locale: initialLocale,
  authenticated,
}: {
  children: ReactNode;
  locale: AppLocale;
  authenticated: boolean;
}) {
  const router = useRouter();
  const [locale, setCurrentLocale] = useState(initialLocale);

  useEffect(() => setCurrentLocale(initialLocale), [initialLocale]);

  const setLocale = useCallback(async (nextLocale: AppLocale) => {
    if (nextLocale === locale) return;

    const previousLocale = locale;
    setCurrentLocale(nextLocale);

    try {
      if (authenticated) {
        const profileResponse = await fetch('/api/profile', { cache: 'no-store' });
        if (!profileResponse.ok) throw new Error('locale_update_failed');
        const profile = await profileResponse.json() as { name?: unknown; phone?: unknown };
        if (typeof profile.name !== 'string' || (profile.phone !== null && typeof profile.phone !== 'string')) {
          throw new Error('locale_update_failed');
        }
        const response = await mutatingFetch('/api/profile', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: profile.name, phone: profile.phone, locale: nextLocale }),
        });
        if (!response.ok) throw new Error('locale_update_failed');
      }
      persistLocaleCookie(nextLocale);
      router.refresh();
    } catch {
      setCurrentLocale(previousLocale);
      throw new Error('locale_update_failed');
    }
  }, [authenticated, locale, router]);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    t: createTranslator(locale),
    formatDate: (input, options) => new Intl.DateTimeFormat(dateTimeLocales[locale], {
      timeZone: 'Europe/Kyiv',
      ...options,
    }).format(input instanceof Date ? input : new Date(input)),
    formatNumber: (input, options) => new Intl.NumberFormat(dateTimeLocales[locale], options).format(input),
    setLocale,
  }), [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used within I18nProvider');
  return context;
}
