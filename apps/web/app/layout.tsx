import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { SIDEBAR_PREFERENCE_SCRIPT } from '../src/components/sidebar-preference';
import './globals.css';

export const metadata: Metadata = {
  title: 'AutoSale',
  description: 'Instagram order management',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="uk" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: SIDEBAR_PREFERENCE_SCRIPT }} /></head>
      <body>{children}</body>
    </html>
  );
}
