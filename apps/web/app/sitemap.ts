import type { MetadataRoute } from 'next';
import { article } from '../src/marketing/content/articles';
import { locales } from '../src/marketing/routing/locales';

const origin = 'https://sales-aito.com';
const paths = [
  '',
  '/platform',
  '/features/ai-sales-operator',
  '/integrations',
  '/solutions',
  '/about',
  '/pricing',
  '/demo',
  '/blog',
  `/blog/${article.slug}`,
];

export default function sitemap(): MetadataRoute.Sitemap {
  return locales.flatMap((locale) => paths.map((path) => ({
    url: `${origin}/${locale}${path}`,
    alternates: {
      languages: {
        uk: `${origin}/uk${path}`,
        en: `${origin}/en${path}`,
      },
    },
  })));
}
