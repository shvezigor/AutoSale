import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { DM_Sans, Plus_Jakarta_Sans, Space_Grotesk } from 'next/font/google';
import type { ReactNode } from 'react';

import { getServerSession } from '../src/auth/session';
import { SIDEBAR_PREFERENCE_SCRIPT } from '../src/components/sidebar-preference';
import { I18nProvider } from '../src/i18n/i18n-provider';
import { resolveServerLocale } from '../src/i18n/server';
import './globals.css';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin', 'cyrillic-ext'],
  display: 'swap',
});
const bodyFont = DM_Sans({ subsets: ['latin'], variable: '--font-body' });
const displayFont = Space_Grotesk({ subsets: ['latin'], variable: '--font-display' });

export const metadata: Metadata = {
  metadataBase: new URL('https://sales-aito.com'),
  title: { default: 'Sales AITO', template: '%s | Sales AITO' },
  description: 'AI sales operator for social commerce.',
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const session = await getServerSession();
  const requestHeaders = await headers();
  const marketingLocale = requestHeaders.get('x-sales-aito-locale');
  const locale = marketingLocale === 'en' || marketingLocale === 'uk'
    ? marketingLocale
    : await resolveServerLocale(session?.locale);

  return (
    <html lang={locale} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: SIDEBAR_PREFERENCE_SCRIPT }} /></head>
      <body className={`${jakarta.className} ${bodyFont.variable} ${displayFont.variable}`}>
        <I18nProvider locale={locale} authenticated={Boolean(session)}>{children}</I18nProvider>
      </body>
    </html>
  );
}
