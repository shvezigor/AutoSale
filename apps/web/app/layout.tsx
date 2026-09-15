import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { getServerSession } from '../src/auth/session';
import { SIDEBAR_PREFERENCE_SCRIPT } from '../src/components/sidebar-preference';
import { I18nProvider } from '../src/i18n/i18n-provider';
import { resolveServerLocale } from '../src/i18n/server';
import './globals.css';

export const metadata: Metadata = {
  title: 'AutoSale',
  description: 'Instagram order management',
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const session = await getServerSession();
  const locale = await resolveServerLocale(session?.locale);

  return (
    <html lang={locale} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: SIDEBAR_PREFERENCE_SCRIPT }} /></head>
      <body><I18nProvider locale={locale} authenticated={Boolean(session)}>{children}</I18nProvider></body>
    </html>
  );
}
