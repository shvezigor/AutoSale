'use client';

import { usePathname } from 'next/navigation';

import { alternateLocale, type Locale } from '../routing/locales';

export function LocaleSwitcher({ locale, className }: { locale: Locale; className?: string }) {
  const pathname = usePathname();
  const target = alternateLocale(locale);
  const equivalentPath = pathname.replace(/^\/(uk|en)(?=\/|$)/, `/${target}`);
  return <a className={className} href={equivalentPath} hrefLang={target} lang={target} aria-label={locale === 'uk' ? 'Switch to English' : 'Перемкнути на українську'}>{target.toUpperCase()}</a>;
}
