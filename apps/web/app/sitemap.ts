import type { MetadataRoute } from 'next';
import { article } from '../src/marketing/content/articles';
import { locales } from '../src/marketing/routing/locales';
const paths = ['', '/platform', '/features/ai-sales-operator', '/integrations', '/solutions', '/about', '/pricing', '/demo', '/blog', `/blog/${article.slug}`];
export default function sitemap(): MetadataRoute.Sitemap { const lastModified = new Date('2026-09-17T00:00:00.000Z'); return locales.flatMap((locale) => paths.map((path) => ({ url: `https://sales-aito.com/${locale}${path}`, lastModified, changeFrequency: path.startsWith('/blog') ? 'weekly' as const : 'monthly' as const, priority: path === '' ? 1 : path === '/pricing' ? .9 : .7, alternates: { languages: { uk: `https://sales-aito.com/uk${path}`, en: `https://sales-aito.com/en${path}` } } }))); }
