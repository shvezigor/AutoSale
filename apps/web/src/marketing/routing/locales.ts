export const locales = ['uk', 'en'] as const;

export type Locale = (typeof locales)[number];

export function isLocale(value: string): value is Locale {
  return locales.includes(value as Locale);
}

export function localizedPath(locale: Locale, path = ''): string {
  if (path === '' || path === '/') return `/${locale}`;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `/${locale}${cleanPath}`;
}

export function alternateLocale(locale: Locale): Locale {
  return locale === 'uk' ? 'en' : 'uk';
}
