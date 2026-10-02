import type { AppLocale } from '../i18n/locales';

const copy = {
  uk: {
    navigation: { overview: 'Огляд', clients: 'Клієнти', operations: 'Операції', label: 'Навігація адміністратора' },
    shell: { context: 'Адміністрування платформи', openMenu: 'Відкрити меню', closeMenu: 'Закрити меню', logout: 'Вийти', loggingOut: 'Виходимо…' },
    dashboard: {
      eyebrow: 'Стан системи', title: 'Огляд платформи', description: 'Ключові показники клієнтів і фонової обробки без доступу до бізнес-даних.',
      healthy: 'Усе працює', degraded: 'Потрібна увага', updated: 'Оновлено {date}',
      metrics: { clients: 'Усі клієнти', active: 'Активні', blocked: 'Заблоковані', users: 'Користувачі', orders: 'Замовлення', newClients: 'Нові за 30 днів' },
      clientsAction: 'Переглянути клієнтів', operationsTitle: 'Фонові процеси', operationsDescription: 'Черги, які зараз впливають на автоматичну обробку.', operationsAction: 'Відкрити моніторинг', allQueuesHealthy: 'Черги працюють без активних інцидентів.', waiting: 'Очікує: {count}', failed: 'Помилки: {count}', workers: 'Воркери: {count}', attention: 'Потребує уваги',
    },
    queues: { instagram: 'Instagram', catalogue: 'Каталог', delivery: 'Доставка', telegram: 'Telegram', 'tenant-lifecycle': 'Життєвий цикл даних' },
    clients: {
      eyebrow: 'Клієнти Sales AITO', title: 'Організації', description: 'Загальна неконфіденційна інформація, доступ і агрегати використання.', searchPlaceholder: 'Назва або email власника', statusLabel: 'Статус', allStatuses: 'Усі статуси', active: 'Активна', blocked: 'Заблокована', empty: 'Нічого не знайдено',
      columns: { number: '№', organization: 'Організація', owner: 'Власник', users: 'Користувачі', orders: 'Замовлення', status: 'Статус', created: 'Створено', action: 'Дія' }, view: 'Переглянути', sortName: 'Сортувати за назвою', sortUsers: 'Сортувати за користувачами', sortOrders: 'Сортувати за замовленнями', sortDate: 'Сортувати за датою', total: 'Усього: {count}',
    },
    clientDetail: {
      back: 'До списку клієнтів', eyebrow: 'Клієнт Sales AITO', owner: 'Власник', users: 'Користувачі', orders: 'Замовлення', created: 'Створено', status: 'Статус', active: 'Активна', blocked: 'Заблокована', accessTitle: 'Доступ організації', accessDescription: 'Блокування завершує активні сесії команди. Дані організації залишаються збереженими.', block: 'Заблокувати організацію', blocking: 'Блокуємо…', unblock: 'Розблокувати організацію', unblocking: 'Розблоковуємо…', blockTitle: 'Заблокувати {name}?', blockDescription: 'Усі активні сесії цієї організації будуть завершені.', blockConfirm: 'Так, заблокувати', unblockTitle: 'Розблокувати {name}?', unblockDescription: 'Команда знову зможе входити до робочого простору.', unblockConfirm: 'Так, розблокувати', mutationFailed: 'Не вдалося змінити доступ. Спробуйте ще раз.', dataTitle: 'Керування даними', dataDescription: 'Експорт і підготовка до видалення із додатковим підтвердженням адміністратора.',
    },
  },
  en: {
    navigation: { overview: 'Overview', clients: 'Clients', operations: 'Operations', label: 'Administrator navigation' },
    shell: { context: 'Platform administration', openMenu: 'Open menu', closeMenu: 'Close menu', logout: 'Log out', loggingOut: 'Logging out…' },
    dashboard: {
      eyebrow: 'System state', title: 'Platform overview', description: 'Key client and background-processing indicators without access to business data.',
      healthy: 'Everything is operational', degraded: 'Attention required', updated: 'Updated {date}',
      metrics: { clients: 'All clients', active: 'Active', blocked: 'Blocked', users: 'Users', orders: 'Orders', newClients: 'New in 30 days' },
      clientsAction: 'View clients', operationsTitle: 'Background processes', operationsDescription: 'Queues currently affecting automated processing.', operationsAction: 'Open monitoring', allQueuesHealthy: 'Queues have no active incidents.', waiting: 'Waiting: {count}', failed: 'Failed: {count}', workers: 'Workers: {count}', attention: 'Attention required',
    },
    queues: { instagram: 'Instagram', catalogue: 'Catalogue', delivery: 'Delivery', telegram: 'Telegram', 'tenant-lifecycle': 'Data lifecycle' },
    clients: {
      eyebrow: 'Sales AITO clients', title: 'Organizations', description: 'General non-confidential information, access and usage aggregates.', searchPlaceholder: 'Name or owner email', statusLabel: 'Status', allStatuses: 'All statuses', active: 'Active', blocked: 'Blocked', empty: 'Nothing found',
      columns: { number: '#', organization: 'Organization', owner: 'Owner', users: 'Users', orders: 'Orders', status: 'Status', created: 'Created', action: 'Action' }, view: 'View', sortName: 'Sort by name', sortUsers: 'Sort by users', sortOrders: 'Sort by orders', sortDate: 'Sort by date', total: 'Total: {count}',
    },
    clientDetail: {
      back: 'Back to clients', eyebrow: 'Sales AITO client', owner: 'Owner', users: 'Users', orders: 'Orders', created: 'Created', status: 'Status', active: 'Active', blocked: 'Blocked', accessTitle: 'Organization access', accessDescription: 'Blocking ends the team’s active sessions. Organization data remains stored.', block: 'Block organization', blocking: 'Blocking…', unblock: 'Unblock organization', unblocking: 'Unblocking…', blockTitle: 'Block {name}?', blockDescription: 'All active sessions for this organization will be ended.', blockConfirm: 'Yes, block', unblockTitle: 'Unblock {name}?', unblockDescription: 'The team will be able to sign in to the workspace again.', unblockConfirm: 'Yes, unblock', mutationFailed: 'Could not change access. Try again.', dataTitle: 'Data management', dataDescription: 'Export and deletion preparation with additional administrator confirmation.',
    },
  },
} as const;

export function getAdminCopy(locale: AppLocale) { return copy[locale]; }
