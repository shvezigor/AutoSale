export const dashboardMonthlyRevenue = [31, 87, 58, 40, 53, 100, 43, 92, 63, 48, 68, 28] as const;

export const dashboardMetrics = [
  { key: 'revenue', value: '18 420 ₴', trend: '+12,08%', tone: 'purple', sparkline: '0,26 12,21 23,28 34,14 45,20 56,8 67,12 78,4 96,9' },
  { key: 'orders', value: '34', trend: '+8,40%', tone: 'yellow', sparkline: '0,18 12,24 24,15 36,20 48,10 60,18 72,8 84,15 96,7' },
  { key: 'dialogs', value: '7', trend: '3 без відповіді', tone: 'red', sparkline: '0,11 12,8 24,18 36,16 48,26 60,14 72,20 84,10 96,15' },
  { key: 'average', value: '2 470 ₴', trend: '+3,40%', tone: 'green', sparkline: '0,20 12,19 24,24 36,15 48,18 60,13 72,20 84,11 96,15' },
] as const;

export const dashboardSources = [
  { label: 'Direct-повідомлення', value: 52, tone: 'purple' },
  { label: 'Коментарі', value: 26, tone: 'green' },
  { label: 'Stories-відповіді', value: 15, tone: 'yellow' },
  { label: 'Вручну', value: 7, tone: 'gray' },
] as const;

export const dashboardQueue = [
  { product: 'Труси, розмір M', customer: 'Instagram · 18:53', confidence: 'Телефон розпізнано' },
  { product: 'Футболка Base, чорна', customer: 'Instagram · 18:41', confidence: 'Потрібно уточнити розмір' },
] as const;

export type DashboardMetricKey = typeof dashboardMetrics[number]['key'];
