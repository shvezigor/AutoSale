import type { AppLocale } from '../i18n/locales';

const copy = {
  uk: {
    navigation: { overview: 'Огляд', clients: 'Клієнти', leads: 'Демозаявки', conversions: 'Конверсії', integrations: 'Інтеграції', operations: 'Операції', label: 'Навігація адміністратора' },
    shell: { context: 'Адміністрування платформи', openMenu: 'Відкрити меню', closeMenu: 'Закрити меню', logout: 'Вийти', loggingOut: 'Виходимо…' },
    dashboard: {
      eyebrow: 'Стан системи', title: 'Огляд платформи', description: 'Ключові показники клієнтів і фонової обробки без доступу до бізнес-даних.',
      healthy: 'Усе працює', degraded: 'Потрібна увага', updated: 'Оновлено {date}',
      metrics: { clients: 'Усі клієнти', active: 'Активні', blocked: 'Заблоковані', users: 'Користувачі', orders: 'Замовлення', newClients: 'Нові за 30 днів' },
      clientsAction: 'Переглянути клієнтів', operationsTitle: 'Фонові процеси', operationsDescription: 'Черги, які зараз впливають на автоматичну обробку.', operationsAction: 'Відкрити моніторинг', allQueuesHealthy: 'Черги працюють без активних інцидентів.', waiting: 'Очікує: {count}', failed: 'Помилки: {count}', workers: 'Воркери: {count}', attention: 'Потребує уваги',
    },
    queues: { instagram: 'Instagram', catalogue: 'Каталог', delivery: 'Доставка', telegram: 'Telegram', 'tenant-lifecycle': 'Життєвий цикл даних', 'ai-replies': 'AI-чернетки', 'demo-leads': 'Демозаявки' },
    clients: {
      eyebrow: 'Клієнти Sales AITO', title: 'Організації', description: 'Загальна неконфіденційна інформація, доступ і агрегати використання.', searchPlaceholder: 'Назва або email власника', statusLabel: 'Статус', allStatuses: 'Усі статуси', active: 'Активна', blocked: 'Заблокована', empty: 'Нічого не знайдено',
      columns: { number: '№', organization: 'Організація', owner: 'Власник', users: 'Користувачі', orders: 'Замовлення', status: 'Статус', created: 'Створено', action: 'Дія' }, view: 'Переглянути', sortName: 'Сортувати за назвою', sortUsers: 'Сортувати за користувачами', sortOrders: 'Сортувати за замовленнями', sortDate: 'Сортувати за датою', total: 'Усього: {count}',
    },
    leads: {
      eyebrow: 'Запити на демо', title: 'Демозаявки', description: 'Опрацьовуйте запити окремо від організацій клієнтів.', statusLabel: 'Статус', allStatuses: 'Усі статуси', empty: 'Заявок із цим статусом немає.', loadMore: 'Показати ще', loading: 'Завантажуємо…', loadFailed: 'Не вдалося завантажити ще заявки.', view: 'Переглянути',
      statuses: { NEW: 'Нова', CONTACTED: 'Опрацьована', QUALIFIED: 'Кваліфікована', CLOSED: 'Закрита' },
      notifications: { PENDING: 'Очікує сповіщення', SENT: 'Сповіщено', FAILED: 'Помилка сповіщення' },
      columns: { company: 'Компанія', contact: 'Контакт', status: 'Статус', notification: 'Сповіщення', created: 'Створено', action: 'Дія' },
      back: 'До демозаявок', detailEyebrow: 'Запит на демо', name: 'Ім’я', email: 'Email', phone: 'Телефон', volume: 'Замовлень на місяць', note: 'Запит', consent: 'Згода', updated: 'Оновлено', actionTitle: 'Опрацювання', actionDescription: 'Зміна статусу фіксується в журналі безпеки.', actionLabels: { CONTACTED: 'Позначити як опрацьовану', QUALIFIED: 'Кваліфікувати', CLOSED: 'Закрити', REOPEN: 'Відкрити повторно' }, saving: 'Зберігаємо…', changed: 'Статус заявки змінив інший адміністратор. Оновіть сторінку.', mutationFailed: 'Не вдалося змінити статус. Спробуйте ще раз.',
      data: { title: 'Дані заявки', description: 'Експорт і видалення потребують повторного введення пароля адміністратора.', export: 'Завантажити JSON', delete: 'Видалити заявку', password: 'Поточний пароль', confirmId: 'Повний ID заявки', confirmHint: 'Введіть ID без змін, щоб підтвердити видалення.', required: 'Заповніть це поле.', mismatch: 'ID не збігається з цією заявкою.', submit: 'Підтвердити', working: 'Виконуємо…', cancel: 'Скасувати', failed: 'Не вдалося виконати дію. Дані форми збережено.', busy: 'Зараз надсилається сповіщення. Спробуйте пізніше.' },
      csv: { open: 'Експорт CSV', title: 'Експорт демозаявок', from: 'Від дати', to: 'До дати', password: 'Поточний пароль', required: 'Заповніть це поле.', range: 'Початкова дата має бути не пізнішою за кінцеву.', limit: 'Знайдено понад 1000 заявок. Звузьте діапазон дат.', submit: 'Завантажити CSV', working: 'Готуємо…', cancel: 'Скасувати', failed: 'Не вдалося завантажити CSV. Введені дані збережено.' },
    },
    clientDetail: {
      back: 'До списку клієнтів', eyebrow: 'Клієнт Sales AITO', owner: 'Власник', users: 'Користувачі', orders: 'Замовлення', created: 'Створено', status: 'Статус', active: 'Активна', blocked: 'Заблокована', accessTitle: 'Доступ організації', accessDescription: 'Блокування завершує активні сесії команди. Дані організації залишаються збереженими.', block: 'Заблокувати організацію', blocking: 'Блокуємо…', unblock: 'Розблокувати організацію', unblocking: 'Розблоковуємо…', blockTitle: 'Заблокувати {name}?', blockDescription: 'Усі активні сесії цієї організації будуть завершені.', blockConfirm: 'Так, заблокувати', unblockTitle: 'Розблокувати {name}?', unblockDescription: 'Команда знову зможе входити до робочого простору.', unblockConfirm: 'Так, розблокувати', mutationFailed: 'Не вдалося змінити доступ. Спробуйте ще раз.', dataTitle: 'Керування даними', dataDescription: 'Експорт і підготовка до видалення із додатковим підтвердженням адміністратора.',
    },
    operations: {
      eyebrow: 'Моніторинг', title: 'Операції та черги', description: 'Поточний технічний стан API, бази даних і фонової обробки. Без payload, логів та даних клієнтів.', updated: 'Оновлено {date}', healthy: 'Працює', degraded: 'Потрібна увага', unavailable: 'Недоступно', idle: 'Очікує роботи', apiDescription: 'Адмін API відповідає', databaseDescription: 'Агрегати PostgreSQL доступні', queuesTitle: 'Фонові черги', queuesDescription: 'Лічильники BullMQ і наявність активних воркерів.',
      demoLeadsTitle: 'Сповіщення про демозаявки', demoLeadsDue: 'Потребують відправлення: {count}', demoLeadsExhausted: 'Вичерпано спроби: {count}',
      columns: { queue: 'Черга', status: 'Стан', waiting: 'Очікує', active: 'В роботі', delayed: 'Відкладено', failed: 'Помилки', completed: 'Завершено', workers: 'Воркери', oldest: 'Найстаріша задача' }, none: '—',
    },
    integrations: {
      eyebrow: 'Канали платформи', title: 'Інтеграції каналів', description: 'Керуйте доступністю Facebook Messenger і TikTok для всіх клієнтів без видалення їхніх підключень і даних.',
      channels: { FACEBOOK_MESSENGER: { name: 'Facebook Messenger', description: 'Вхідні та вихідні повідомлення бізнес-сторінок.' }, TIKTOK_BUSINESS_MESSAGING: { name: 'TikTok', description: 'Повідомлення TikTok Business Messaging.' } },
      states: { ACTIVE: 'Активний', ADMIN_DISABLED: 'Вимкнено адміністратором', DEPLOYMENT_UNAVAILABLE: 'Недоступно в цьому розгортанні' },
      enable: 'Увімкнути', disable: 'Вимкнути', enabling: 'Вмикаємо…', disabling: 'Вимикаємо…', unavailableHint: 'Спочатку налаштуйте інтеграцію на сервері.', confirmTitle: 'Вимкнути {channel}?', confirmDescription: 'Нові повідомлення та відповіді зупиняться. Наявні дані залишаться збереженими. Повідомлення, отримані під час паузи, можуть не відновитися.', confirm: 'Так, вимкнути', mutationFailed: 'Не вдалося оновити канал. Спробуйте ще раз.',
    },
  },
  en: {
    navigation: { overview: 'Overview', clients: 'Clients', leads: 'Demo requests', conversions: 'Conversions', integrations: 'Integrations', operations: 'Operations', label: 'Administrator navigation' },
    shell: { context: 'Platform administration', openMenu: 'Open menu', closeMenu: 'Close menu', logout: 'Log out', loggingOut: 'Logging out…' },
    dashboard: {
      eyebrow: 'System state', title: 'Platform overview', description: 'Key client and background-processing indicators without access to business data.',
      healthy: 'Everything is operational', degraded: 'Attention required', updated: 'Updated {date}',
      metrics: { clients: 'All clients', active: 'Active', blocked: 'Blocked', users: 'Users', orders: 'Orders', newClients: 'New in 30 days' },
      clientsAction: 'View clients', operationsTitle: 'Background processes', operationsDescription: 'Queues currently affecting automated processing.', operationsAction: 'Open monitoring', allQueuesHealthy: 'Queues have no active incidents.', waiting: 'Waiting: {count}', failed: 'Failed: {count}', workers: 'Workers: {count}', attention: 'Attention required',
    },
    queues: { instagram: 'Instagram', catalogue: 'Catalogue', delivery: 'Delivery', telegram: 'Telegram', 'tenant-lifecycle': 'Data lifecycle', 'ai-replies': 'AI drafts', 'demo-leads': 'Demo requests' },
    clients: {
      eyebrow: 'Sales AITO clients', title: 'Organizations', description: 'General non-confidential information, access and usage aggregates.', searchPlaceholder: 'Name or owner email', statusLabel: 'Status', allStatuses: 'All statuses', active: 'Active', blocked: 'Blocked', empty: 'Nothing found',
      columns: { number: '#', organization: 'Organization', owner: 'Owner', users: 'Users', orders: 'Orders', status: 'Status', created: 'Created', action: 'Action' }, view: 'View', sortName: 'Sort by name', sortUsers: 'Sort by users', sortOrders: 'Sort by orders', sortDate: 'Sort by date', total: 'Total: {count}',
    },
    leads: {
      eyebrow: 'Demo requests', title: 'Demo requests', description: 'Process inquiries separately from customer organizations.', statusLabel: 'Status', allStatuses: 'All statuses', empty: 'No requests with this status.', loadMore: 'Load more', loading: 'Loading…', loadFailed: 'Could not load more requests.', view: 'View',
      statuses: { NEW: 'New', CONTACTED: 'Contacted', QUALIFIED: 'Qualified', CLOSED: 'Closed' },
      notifications: { PENDING: 'Notification pending', SENT: 'Notified', FAILED: 'Notification failed' },
      columns: { company: 'Company', contact: 'Contact', status: 'Status', notification: 'Notification', created: 'Created', action: 'Action' },
      back: 'Back to demo requests', detailEyebrow: 'Demo request', name: 'Name', email: 'Email', phone: 'Phone', volume: 'Monthly orders', note: 'Inquiry', consent: 'Consent', updated: 'Updated', actionTitle: 'Processing', actionDescription: 'Status changes are recorded in the security audit.', actionLabels: { CONTACTED: 'Mark as contacted', QUALIFIED: 'Qualify', CLOSED: 'Close', REOPEN: 'Reopen' }, saving: 'Saving…', changed: 'Another administrator changed this request. Refresh the page.', mutationFailed: 'Could not change status. Try again.',
      data: { title: 'Request data', description: 'Export and deletion require the administrator password again.', export: 'Download JSON', delete: 'Delete request', password: 'Current password', confirmId: 'Full request ID', confirmHint: 'Enter the unchanged ID to confirm deletion.', required: 'Complete this field.', mismatch: 'The ID does not match this request.', submit: 'Confirm', working: 'Working…', cancel: 'Cancel', failed: 'Could not complete this action. Your entries were kept.', busy: 'A notification is being sent. Try again later.' },
      csv: { open: 'Export CSV', title: 'Export demo requests', from: 'From date', to: 'Through date', password: 'Current password', required: 'Complete this field.', range: 'The start date must not be after the end date.', limit: 'More than 1000 requests match. Narrow the date range.', submit: 'Download CSV', working: 'Preparing…', cancel: 'Cancel', failed: 'Could not download CSV. Your entries were kept.' },
    },
    clientDetail: {
      back: 'Back to clients', eyebrow: 'Sales AITO client', owner: 'Owner', users: 'Users', orders: 'Orders', created: 'Created', status: 'Status', active: 'Active', blocked: 'Blocked', accessTitle: 'Organization access', accessDescription: 'Blocking ends the team’s active sessions. Organization data remains stored.', block: 'Block organization', blocking: 'Blocking…', unblock: 'Unblock organization', unblocking: 'Unblocking…', blockTitle: 'Block {name}?', blockDescription: 'All active sessions for this organization will be ended.', blockConfirm: 'Yes, block', unblockTitle: 'Unblock {name}?', unblockDescription: 'The team will be able to sign in to the workspace again.', unblockConfirm: 'Yes, unblock', mutationFailed: 'Could not change access. Try again.', dataTitle: 'Data management', dataDescription: 'Export and deletion preparation with additional administrator confirmation.',
    },
    operations: {
      eyebrow: 'Monitoring', title: 'Operations and queues', description: 'Current technical state of the API, database and background processing. No payloads, logs or client data.', updated: 'Updated {date}', healthy: 'Operational', degraded: 'Attention required', unavailable: 'Unavailable', idle: 'Idle', apiDescription: 'Admin API is responding', databaseDescription: 'PostgreSQL aggregates are available', queuesTitle: 'Background queues', queuesDescription: 'BullMQ counters and active worker presence.',
      demoLeadsTitle: 'Demo request notifications', demoLeadsDue: 'Due for delivery: {count}', demoLeadsExhausted: 'Attempts exhausted: {count}',
      columns: { queue: 'Queue', status: 'Status', waiting: 'Waiting', active: 'Active', delayed: 'Delayed', failed: 'Failed', completed: 'Completed', workers: 'Workers', oldest: 'Oldest task' }, none: '—',
    },
    integrations: {
      eyebrow: 'Platform channels', title: 'Channel integrations', description: 'Control Facebook Messenger and TikTok availability for every client without deleting their connections or data.',
      channels: { FACEBOOK_MESSENGER: { name: 'Facebook Messenger', description: 'Inbound and outbound business Page messages.' }, TIKTOK_BUSINESS_MESSAGING: { name: 'TikTok', description: 'TikTok Business Messaging conversations.' } },
      states: { ACTIVE: 'Active', ADMIN_DISABLED: 'Disabled by administrator', DEPLOYMENT_UNAVAILABLE: 'Unavailable in this deployment' },
      enable: 'Enable', disable: 'Disable', enabling: 'Enabling…', disabling: 'Disabling…', unavailableHint: 'Configure the server integration before enabling this channel.', confirmTitle: 'Disable {channel}?', confirmDescription: 'New messages and replies will stop. Existing data will remain stored. Messages received while paused may not be recoverable.', confirm: 'Yes, disable', mutationFailed: 'Could not update the channel. Try again.',
    },
  },
} as const;

export function getAdminCopy(locale: AppLocale) { return copy[locale]; }
