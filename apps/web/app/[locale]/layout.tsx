import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { MarketingFooter } from '../../src/marketing/components/marketing-footer';
import { MarketingHeader } from '../../src/marketing/components/marketing-header';
import { isLocale } from '../../src/marketing/routing/locales';

export function generateStaticParams() { return [{ locale: 'uk' }, { locale: 'en' }]; }

export default async function MarketingLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <div className="marketing"><MarketingHeader locale={locale} />{children}<MarketingFooter locale={locale} /></div>;
}
