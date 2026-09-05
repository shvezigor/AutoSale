import { describe, expect, it, vi } from 'vitest';
import { WorkerNotificationService } from './worker-notification.service.js';

describe('WorkerNotificationService', () => {
  it('notifies only an active member of the export tenant', async () => {
    const create = vi.fn().mockResolvedValue({});
    const prisma = { tenantMembership: { findFirst: vi.fn().mockResolvedValue({ id: 'membership' }) }, userNotification: { create } };
    await new WorkerNotificationService(prisma).orderExportFailed('tenant-a', 'user-a', 'order-a');
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: 'tenant-a', userId: 'user-a', category: 'ORDER_EXPORT_FAILED', actionUrl: '/orders/order-a' }) });
  });

  it('does not guess a recipient', async () => {
    const create = vi.fn();
    const prisma = { tenantMembership: { findFirst: vi.fn() }, userNotification: { create } };
    await new WorkerNotificationService(prisma).orderExportFailed('tenant-a', null, 'order-a');
    expect(create).not.toHaveBeenCalled();
  });

  it('reports catalogue synchronization outcomes to the active source owner', async () => {
    const create = vi.fn().mockResolvedValue({});
    const prisma = { tenantMembership: { findFirst: vi.fn().mockResolvedValue({ id: 'membership' }) }, userNotification: { create } };
    const service = new WorkerNotificationService(prisma);

    await service.catalogueSyncCompleted('tenant-a', 'user-a', { createdRows: 3, updatedRows: 2 });
    await service.catalogueSyncFailed('tenant-a', 'user-a');

    expect(create).toHaveBeenNthCalledWith(1, { data: expect.objectContaining({
      tenantId: 'tenant-a', userId: 'user-a', type: 'SUCCESS', category: 'CATALOGUE_SYNC_COMPLETED',
      message: 'Додано: 3, оновлено: 2', actionUrl: '/catalogue',
    }) });
    expect(create).toHaveBeenNthCalledWith(2, { data: expect.objectContaining({
      tenantId: 'tenant-a', userId: 'user-a', type: 'ERROR', category: 'CATALOGUE_SYNC_FAILED',
      actionUrl: '/settings?tab=data',
    }) });
  });
});
