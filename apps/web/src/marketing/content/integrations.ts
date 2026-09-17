import type { LocalizedValue } from './types';

export type IntegrationStatus = 'available' | 'in-development' | 'roadmap';

export type Integration = {
  id: string;
  name: string;
  status: IntegrationStatus;
  summary: LocalizedValue<string>;
};

export const integrations: Integration[] = [
  { id: 'instagram', name: 'Instagram', status: 'available', summary: { uk: 'Діалоги й замовлення в одному робочому потоці.', en: 'Conversations and orders in one workflow.' } },
  { id: 'google-sheets', name: 'Google Sheets', status: 'available', summary: { uk: 'Експорт підтверджених замовлень у вашу таблицю.', en: 'Export confirmed orders to your spreadsheet.' } },
  { id: 'facebook', name: 'Facebook', status: 'in-development', summary: { uk: 'Обробка повідомлень сторінки разом з іншими каналами.', en: 'Page messages handled alongside other channels.' } },
  { id: 'threads', name: 'Threads', status: 'in-development', summary: { uk: 'Новий канал діалогів у спільній черзі.', en: 'A new conversation channel in the shared queue.' } },
  { id: 'tiktok', name: 'TikTok', status: 'in-development', summary: { uk: 'Звернення з social commerce без ручного перенесення.', en: 'Social commerce enquiries without manual copying.' } },
  { id: 'viber', name: 'Viber', status: 'in-development', summary: { uk: 'Повідомлення покупців у єдиній системі.', en: 'Customer messages inside one system.' } },
  { id: 'nova-poshta', name: 'Нова пошта', status: 'roadmap', summary: { uk: 'Автоматичне створення накладних після перевірки даних.', en: 'Automatic shipping labels after data validation.' } },
  { id: 'ukrposhta', name: 'Укрпошта', status: 'roadmap', summary: { uk: 'Створення відправлень без повторного введення.', en: 'Create shipments without re-entering data.' } },
  { id: 'suppliers', name: 'Supplier workflows', status: 'roadmap', summary: { uk: 'AI сам повідомляє постачальника, якщо товару немає.', en: 'AI notifies a supplier when an item is unavailable.' } },
];
