import type { MarketingCopy } from './types';
import type { Locale } from '../routing/locales';

export const siteCopy: Record<Locale, MarketingCopy> = {
  uk: {
    skipLink: 'Перейти до вмісту',
    navigationLabel: 'Головна навігація',
    menuLabel: 'Меню',
    nav: [
      { href: '/platform', label: 'Платформа' },
      { href: '/features/ai-sales-operator', label: 'AI-оператор' },
      { href: '/integrations', label: 'Інтеграції' },
      { href: '/solutions', label: 'Рішення' },
      { href: '/pricing', label: 'Тарифи' },
      { href: '/blog', label: 'Блог' },
    ],
    signIn: 'Увійти',
    startFree: 'Спробувати 30 днів',
    bookDemo: 'Замовити демо',
    footerSummary: 'AI-оператор продажів, що перетворює діалоги на керований потік замовлень.',
    legal: 'Умови користування',
    privacy: 'Конфіденційність',
    languageName: 'Українська',
  },
  en: {
    skipLink: 'Skip to content',
    navigationLabel: 'Main navigation',
    menuLabel: 'Menu',
    nav: [
      { href: '/platform', label: 'Platform' },
      { href: '/features/ai-sales-operator', label: 'AI operator' },
      { href: '/integrations', label: 'Integrations' },
      { href: '/solutions', label: 'Solutions' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/blog', label: 'Blog' },
    ],
    signIn: 'Sign in',
    startFree: 'Start 30-day trial',
    bookDemo: 'Book a demo',
    footerSummary: 'An AI sales operator that turns conversations into a controlled order flow.',
    legal: 'Terms',
    privacy: 'Privacy',
    languageName: 'English',
  },
};
