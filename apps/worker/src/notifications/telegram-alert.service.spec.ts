import { describe, expect, it, vi } from 'vitest';

import { TelegramAlertService } from './telegram-alert.service.js';

describe('TelegramAlertService', () => {
  it('creates in-app alerts for active members and Telegram delivery only for an enabled linked member', async () => {
    const notifications = new Map<string, { id: string }>();
    const deliveries = new Map<string, unknown>();
    const tx = {
      tenant: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'tenant-1', name: 'Мій магазин' }) },
      tenantMembership: { findMany: vi.fn().mockResolvedValue([{ userId: 'user-1' }, { userId: 'user-2' }]) },
      userNotification: {
        upsert: vi.fn(async ({ where, create }: any) => {
          const key = where.tenantId_userId_eventKey.userId;
          const existing = notifications.get(key);
          if (existing) return existing;
          const value = { id: `notification-${key}` };
          notifications.set(key, value);
          expect(create.message).not.toMatch(/0976536783|Кравчука/i);
          return value;
        }),
      },
      telegramUserBinding: {
        findMany: vi.fn().mockResolvedValue([
          { userId: 'user-1', privateChatId: '101' },
          { userId: 'user-2', privateChatId: '202' },
        ]),
      },
      telegramNotificationPreference: {
        findMany: vi.fn().mockResolvedValue([{ userId: 'user-2', enabled: false }]),
      },
      telegramChat: {
        upsert: vi.fn(async ({ create }: any) => ({ id: `destination-${create.externalChatId}` })),
      },
      telegramDelivery: {
        upsert: vi.fn(async ({ where, create }: any) => {
          deliveries.set(where.tenantId_idempotencyKey.idempotencyKey, create);
          return create;
        }),
      },
    };
    const service = new TelegramAlertService('https://sales-aito.com');
    const event = { eventId: 'event-1', tenantId: 'tenant-1', orderId: 'order-1', type: 'ORDER_NEEDS_REVIEW' as const };

    await service.persist(tx as never, event);
    await service.persist(tx as never, event);

    expect(notifications.size).toBe(2);
    expect(tx.userNotification.upsert).toHaveBeenCalledTimes(4);
    expect(tx.telegramDelivery.upsert).toHaveBeenCalledTimes(2);
    expect(deliveries.size).toBe(1);
    expect([...deliveries.values()][0]).toMatchObject({
      tenantId: 'tenant-1', purpose: 'PERSONAL_ALERT', sourceNotificationId: 'notification-user-1',
      messageText: expect.stringContaining('https://sales-aito.com/orders/order-1'),
    });
    expect(JSON.stringify([...deliveries.values()][0])).toContain('Мій магазин');
  });
});
