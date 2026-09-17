import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { HomePage } from '../../src/marketing/components/home-page';
import { isLocale } from '../../src/marketing/routing/locales';
import { marketingMetadata } from '../../src/marketing/seo/metadata';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return locale === 'uk'
    ? marketingMetadata(locale, '', 'AI-оператор продажів із соцмереж', 'Sales AITO розпізнає замовлення з діалогів, перевіряє товари й автоматизує роботу social commerce команди.')
    : marketingMetadata(locale, '', 'AI sales operator for social commerce', 'Sales AITO recognises orders from conversations, validates products and automates social commerce operations.');
}

export default async function LocalizedHomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const jsonLd = { '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'Sales AITO', applicationCategory: 'BusinessApplication', operatingSystem: 'Web', description: locale === 'uk' ? 'AI-оператор продажів із соцмереж' : 'AI sales operator for social commerce' };
  return <><HomePage locale={locale} /><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} /></>;
}
