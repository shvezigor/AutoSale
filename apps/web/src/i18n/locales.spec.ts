import { describe, expect, it } from 'vitest';

import { parseLocale, preferredLocaleFromHeader } from './locales';

describe('locale parsing', () => {
  it('accepts only the two stored locale identifiers', () => {
    expect(parseLocale('uk')).toBe('uk');
    expect(parseLocale('en')).toBe('en');
    expect(parseLocale('en-US')).toBeNull();
    expect(parseLocale(undefined)).toBeNull();
  });

  it('selects the highest-priority supported browser language', () => {
    expect(preferredLocaleFromHeader('fr-FR, en-US;q=0.9, uk;q=0.8')).toBe('en');
    expect(preferredLocaleFromHeader('en;q=0.5, uk-UA;q=0.9')).toBe('uk');
    expect(preferredLocaleFromHeader('pl-PL')).toBeNull();
    expect(preferredLocaleFromHeader(null)).toBeNull();
  });
});
