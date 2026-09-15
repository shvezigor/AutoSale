import { cookies, headers } from 'next/headers';

import { DEFAULT_LOCALE, LOCALE_COOKIE, parseLocale, preferredLocaleFromHeader, type AppLocale } from './locales';

export async function resolveServerLocale(sessionLocale?: unknown): Promise<AppLocale> {
  const authenticatedLocale = parseLocale(sessionLocale);
  if (authenticatedLocale) return authenticatedLocale;

  const cookieLocale = parseLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  if (cookieLocale) return cookieLocale;

  const browserLocale = preferredLocaleFromHeader((await headers()).get('accept-language'));
  return browserLocale ?? DEFAULT_LOCALE;
}
