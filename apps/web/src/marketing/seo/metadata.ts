import type { Metadata } from 'next';

import { alternateLocale, localizedPath, type Locale } from '../routing/locales';

const origin = 'https://sales-aito.com';

export function marketingMetadata(locale: Locale, path: string, title: string, description: string): Metadata {
  const canonicalPath = localizedPath(locale, path);
  const alternate = alternateLocale(locale);
  return {
    title,
    description,
    robots: { index: true, follow: true },
    alternates: {
      canonical: `${origin}${canonicalPath}`,
      languages: {
        uk: `${origin}${localizedPath('uk', path)}`,
        en: `${origin}${localizedPath('en', path)}`,
        'x-default': `${origin}${localizedPath('uk', path)}`,
      },
    },
    openGraph: {
      type: 'website',
      siteName: 'Sales AITO',
      locale: locale === 'uk' ? 'uk_UA' : 'en_US',
      title,
      description,
      url: `${origin}${canonicalPath}`,
      images: [{ url: '/images/sales-aito-ai-operator-hero.png', width: 1536, height: 1024, alt: 'Sales AITO AI sales operator' }],
    },
    other: { 'content-language': locale, 'alternate-locale': alternate },
  };
}
