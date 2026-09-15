export const supportedLocales = ['uk', 'en'] as const;

export type AppLocale = (typeof supportedLocales)[number];

export const DEFAULT_LOCALE: AppLocale = 'uk';
export const LOCALE_COOKIE = 'autosale_locale';

export function parseLocale(value: unknown): AppLocale | null {
  return value === 'uk' || value === 'en' ? value : null;
}

export function preferredLocaleFromHeader(value: string | null): AppLocale | null {
  if (!value) return null;

  const candidates = value
    .split(',')
    .map((part, index) => {
      const [language = '', ...parameters] = part.trim().toLowerCase().split(';');
      const qualityParameter = parameters.find((parameter) => parameter.trim().startsWith('q='));
      const parsedQuality = qualityParameter ? Number(qualityParameter.trim().slice(2)) : 1;
      return { language, quality: Number.isFinite(parsedQuality) ? parsedQuality : 0, index };
    })
    .sort((left, right) => right.quality - left.quality || left.index - right.index);

  for (const candidate of candidates) {
    const base = candidate.language.split('-')[0];
    const locale = parseLocale(base);
    if (locale) return locale;
  }
  return null;
}
