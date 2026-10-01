import { type PrismaClient, withTenantTransaction } from '@autosale/database';

export class WorkerNotificationService {
  constructor(private readonly prisma: PrismaClient) {}

  async orderExportFailed(tenantId: string, userId: string | null, orderId: string): Promise<void> {
    await this.createForActiveMember(tenantId, userId, {
      type: 'ERROR', category: 'ORDER_EXPORT_FAILED',
      title: 'Не вдалося експортувати замовлення', message: 'Перевірте підключення Google Sheets і повторіть спробу.',
      actionUrl: `/orders/${orderId}`,
    });
  }

  async catalogueSyncCompleted(tenantId: string, userId: string | null, counts: { createdRows: number; updatedRows: number }): Promise<void> {
    await this.createForActiveMember(tenantId, userId, {
      type: 'SUCCESS', category: 'CATALOGUE_SYNC_COMPLETED', title: 'Каталог синхронізовано',
      message: `Додано: ${counts.createdRows}, оновлено: ${counts.updatedRows}`, actionUrl: '/catalogue',
    });
  }

  async catalogueSyncFailed(tenantId: string, userId: string | null): Promise<void> {
    await this.createForActiveMember(tenantId, userId, {
      type: 'ERROR', category: 'CATALOGUE_SYNC_FAILED', title: 'Не вдалося синхронізувати каталог',
      message: 'Перевірте джерело товарів і повторіть спробу.', actionUrl: '/settings?tab=data',
    });
  }

  private async createForActiveMember(tenantId: string, userId: string | null, notification: {
    type: 'SUCCESS' | 'ERROR'; category: string; title: string; message: string; actionUrl: string;
  }): Promise<void> {
    if (!userId) return;
    await withTenantTransaction(this.prisma, tenantId, async (transaction) => {
      const membership = await transaction.tenantMembership.findFirst({
        where: { tenantId, userId, status: 'ACTIVE' }, select: { id: true },
      });
      if (!membership) return;
      await transaction.userNotification.create({ data: {
        tenantId, userId, ...notification,
      } });
    });
  }
}
