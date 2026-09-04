type NotificationStore = {
  tenantMembership: { findFirst(input: unknown): Promise<{ id: string } | null> };
  userNotification: { create(input: unknown): Promise<unknown> };
};

export class WorkerNotificationService {
  constructor(private readonly prisma: NotificationStore) {}

  async orderExportFailed(tenantId: string, userId: string | null, orderId: string): Promise<void> {
    if (!userId) return;
    const membership = await this.prisma.tenantMembership.findFirst({
      where: { tenantId, userId, status: 'ACTIVE' }, select: { id: true },
    });
    if (!membership) return;
    await this.prisma.userNotification.create({ data: {
      tenantId, userId, type: 'ERROR', category: 'ORDER_EXPORT_FAILED',
      title: 'Не вдалося експортувати замовлення', message: 'Перевірте підключення Google Sheets і повторіть спробу.',
      actionUrl: `/orders/${orderId}`,
    } });
  }
}
