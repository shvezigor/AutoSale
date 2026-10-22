import { describe, expect, it } from 'vitest';
import sitemap from './sitemap';

describe('public sitemap', () => {
  it('lists only localized public pages with reciprocal language URLs', () => {
    const entries = sitemap();
    expect(entries).toHaveLength(20);
    expect(entries.map((entry) => entry.url)).toContain('https://sales-aito.com/uk');
    expect(entries.map((entry) => entry.url)).toContain('https://sales-aito.com/en');

    for (const entry of entries) {
      expect(entry.url).toMatch(/^https:\/\/sales-aito\.com\/(uk|en)(\/|$)/);
      expect(entry.alternates?.languages).toEqual({
        uk: entry.url.replace(/\/(uk|en)(?=\/|$)/, '/uk'),
        en: entry.url.replace(/\/(uk|en)(?=\/|$)/, '/en'),
      });
      expect(entry).not.toHaveProperty('lastModified');
      expect(entry).not.toHaveProperty('changeFrequency');
      expect(entry).not.toHaveProperty('priority');
    }
  });
});
