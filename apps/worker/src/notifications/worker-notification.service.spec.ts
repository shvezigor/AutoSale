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
});
