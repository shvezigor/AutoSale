import { describe, expect, it } from 'vitest';
import { alternateLocale, isLocale, localizedPath } from './locales';
describe('marketing locale routing', () => {
  it('only accepts supported locales', () => { expect(isLocale('uk')).toBe(true); expect(isLocale('de')).toBe(false); });
  it('builds equivalent localized paths', () => { expect(localizedPath('en', '/pricing')).toBe('/en/pricing'); expect(alternateLocale('en')).toBe('uk'); });
  it('uses the canonical locale root path', () => { expect(localizedPath('uk')).toBe('/uk'); });
});
