import { mutatingFetch } from '../auth/csrf-fetch';

export type NotificationItem = {
  id: string;
  type: 'SUCCESS' | 'ERROR' | 'WARNING' | 'INFO';
  category: string;
  title: string;
  message: string | null;
  actionUrl: string | null;
  readAt: string | null;
  createdAt: string;
};

export type NotificationList = { items: NotificationItem[]; unreadCount: number };

export async function getNotifications(): Promise<NotificationList> {
  const response = await fetch('/api/notifications?limit=20', { cache: 'no-store' });
  if (!response.ok) throw new Error('Не вдалося завантажити сповіщення');
  return response.json() as Promise<NotificationList>;
}

export async function markNotificationRead(id: string): Promise<void> {
  const response = await mutatingFetch(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
  if (!response.ok) throw new Error('Не вдалося оновити сповіщення');
}

export async function markAllNotificationsRead(): Promise<void> {
  const response = await mutatingFetch('/api/notifications/read-all', { method: 'POST' });
  if (!response.ok) throw new Error('Не вдалося оновити сповіщення');
}
