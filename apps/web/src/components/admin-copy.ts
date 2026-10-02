import type { AppLocale } from '../i18n/locales';

const copy = {
  uk: {
    navigation: { overview: 'Огляд', clients: 'Клієнти', operations: 'Операції', label: 'Навігація адміністратора' },
    shell: { context: 'Адміністрування платформи', openMenu: 'Відкрити меню', closeMenu: 'Закрити меню', logout: 'Вийти', loggingOut: 'Виходимо…' },
  },
  en: {
    navigation: { overview: 'Overview', clients: 'Clients', operations: 'Operations', label: 'Administrator navigation' },
    shell: { context: 'Platform administration', openMenu: 'Open menu', closeMenu: 'Close menu', logout: 'Log out', loggingOut: 'Logging out…' },
  },
} as const;

export function getAdminCopy(locale: AppLocale) { return copy[locale]; }
