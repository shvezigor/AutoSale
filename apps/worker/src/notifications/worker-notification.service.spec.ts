import { describe, expect, it, vi } from 'vitest';
import { WorkerNotificationService } from './worker-notification.service.js';

const tenantId = '10000000-0000-4000-8000-000000000001';

describe('WorkerNotificationService', () => {
  it('notifies only an active member of the export tenant', async () => {
    const create = vi.fn().mockResolvedValue({});
    const prisma = transactional({ tenantMembership: { findFirst: vi.fn().mockResolvedValue({ id: 'membership' }) }, userNotification: { create } });
    await new WorkerNotificationService(prisma as never).orderExportFailed(tenantId, 'user-a', 'order-a');
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId, userId: 'user-a', category: 'ORDER_EXPORT_FAILED', actionUrl: '/orders/order-a' }) });
  });

  it('does not guess a recipient', async () => {
    const create = vi.fn();
    const prisma = transactional({ tenantMembership: { findFirst: vi.fn() }, userNotification: { create } });
    await new WorkerNotificationService(prisma as never).orderExportFailed(tenantId, null, 'order-a');
    expect(create).not.toHaveBeenCalled();
  });

  it('reports catalogue synchronization outcomes to the active source owner', async () => {
    const create = vi.fn().mockResolvedValue({});
    const prisma = transactional({ tenantMembership: { findFirst: vi.fn().mockResolvedValue({ id: 'membership' }) }, userNotification: { create } });
    const service = new WorkerNotificationService(prisma as never);

    await service.catalogueSyncCompleted(tenantId, 'user-a', { createdRows: 3, updatedRows: 2 });
    await service.catalogueSyncFailed(tenantId, 'user-a');

    expect(create).toHaveBeenNthCalledWith(1, { data: expect.objectContaining({
      tenantId, userId: 'user-a', type: 'SUCCESS', category: 'CATALOGUE_SYNC_COMPLETED',
      message: 'Додано: 3, оновлено: 2', actionUrl: '/catalogue',
    }) });
    expect(create).toHaveBeenNthCalledWith(2, { data: expect.objectContaining({
      tenantId, userId: 'user-a', type: 'ERROR', category: 'CATALOGUE_SYNC_FAILED',
      actionUrl: '/settings?tab=data',
    }) });
  });
});

function transactional<T extends object>(store: T): T & { $queryRaw: ReturnType<typeof vi.fn>; $transaction: (operation: (tx: T & { $queryRaw: ReturnType<typeof vi.fn> }) => Promise<unknown>) => Promise<unknown> } {
  const transaction = { ...store, $queryRaw: vi.fn().mockResolvedValue([]) };
  return { ...transaction, $transaction: (operation) => operation(transaction) };
}
