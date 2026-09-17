import type { Locale } from '../routing/locales';

export type LocalizedValue<T> = Record<Locale, T>;

export type NavItem = {
  href: string;
  label: string;
};

export type MarketingCopy = {
  skipLink: string;
  navigationLabel: string;
  menuLabel: string;
  nav: NavItem[];
  signIn: string;
  startFree: string;
  bookDemo: string;
  footerSummary: string;
  legal: string;
  privacy: string;
  languageName: string;
};
