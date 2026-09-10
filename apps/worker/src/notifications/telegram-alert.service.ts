import type { Prisma } from '@autosale/database';

export type TelegramAlertEvent = {
  eventId: string;
  tenantId: string;
  orderId: string;
  type: 'ORDER_NEEDS_REVIEW' | 'ORDER_AUTO_APPROVED' | 'SUPPLIER_DELIVERY_FAILED';
};

const copy = {
  ORDER_NEEDS_REVIEW: {
    notificationType: 'WARNING' as const,
    title: 'Замовлення потребує перевірки',
    status: 'Потрібна перевірка менеджера',
  },
  ORDER_AUTO_APPROVED: {
    notificationType: 'SUCCESS' as const,
    title: 'Замовлення створено автоматично',
    status: 'Замовлення автоматично підтверджено',
  },
  SUPPLIER_DELIVERY_FAILED: {
    notificationType: 'ERROR' as const,
    title: 'Не вдалося надіслати замовлення постачальнику',
    status: 'Потрібна повторна відправка постачальнику',
  },
};

export class TelegramAlertService {
  constructor(private readonly appPublicUrl: string) {}

  async persist(tx: Prisma.TransactionClient, event: TelegramAlertEvent): Promise<void> {
    const [tenant, members, bindings, preferences] = await Promise.all([
      tx.tenant.findUniqueOrThrow({ where: { id: event.tenantId }, select: { id: true, name: true } }),
      tx.tenantMembership.findMany({
        where: { tenantId: event.tenantId, status: 'ACTIVE', user: { status: 'ACTIVE' } },
        select: { userId: true },
      }),
      tx.telegramUserBinding.findMany({
        where: { tenantId: event.tenantId, revokedAt: null },
        select: { userId: true, privateChatId: true },
      }),
      tx.telegramNotificationPreference.findMany({
        where: { tenantId: event.tenantId, eventType: event.type },
        select: { userId: true, enabled: true },
      }),
    ]);
    const bindingByUser = new Map(bindings.map((binding) => [binding.userId, binding]));
    const preferenceByUser = new Map(preferences.map((preference) => [preference.userId, preference.enabled]));
    const eventCopy = copy[event.type];
    const actionUrl = `/orders/${event.orderId}`;
    const absoluteUrl = new URL(actionUrl, this.appPublicUrl).toString();
    const shortOrderId = event.orderId.slice(0, 8);

    for (const member of members) {
      const notification = await tx.userNotification.upsert({
        where: {
          tenantId_userId_eventKey: {
            tenantId: event.tenantId,
            userId: member.userId,
            eventKey: `${event.type}:${event.eventId}`,
          },
        },
        create: {
          tenantId: event.tenantId,
          userId: member.userId,
          type: eventCopy.notificationType,
          category: event.type,
          title: eventCopy.title,
          message: `Замовлення #${shortOrderId}: ${eventCopy.status}.`,
          actionUrl,
          eventKey: `${event.type}:${event.eventId}`,
        },
        update: {},
        select: { id: true },
      });

      const binding = bindingByUser.get(member.userId);
      if (!binding || preferenceByUser.get(member.userId) === false) continue;
      const destination = await tx.telegramChat.upsert({
        where: {
          tenantId_externalChatId_route: {
            tenantId: event.tenantId,
            externalChatId: binding.privateChatId,
            route: 'BOT',
          },
        },
        create: {
          tenantId: event.tenantId,
          externalChatId: binding.privateChatId,
          type: 'private',
          title: 'Особисті сповіщення',
          route: 'BOT',
          lastObservedAt: new Date(),
        },
        update: { lastObservedAt: new Date() },
        select: { id: true },
      });
      await tx.telegramDelivery.upsert({
        where: {
          tenantId_idempotencyKey: {
            tenantId: event.tenantId,
            idempotencyKey: `personal-alert:${notification.id}`,
          },
        },
        create: {
          tenantId: event.tenantId,
          destinationId: destination.id,
          orderId: event.orderId,
          sourceNotificationId: notification.id,
          purpose: 'PERSONAL_ALERT',
          status: 'PENDING',
          idempotencyKey: `personal-alert:${notification.id}`,
          messageText: `${tenant.name}\nЗамовлення #${shortOrderId}\n${eventCopy.status}\n${absoluteUrl}`,
        },
        update: {},
      });
    }
  }
}
