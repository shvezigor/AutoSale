import { describe, expect, it, vi } from 'vitest';

import { NotificationService } from './notifications.service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';

function createHarness() {
  const store = {
    userNotification: {
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    ...store,
    $transaction: vi.fn(async (operation: (transaction: typeof store & { $queryRaw: ReturnType<typeof vi.fn> }) => Promise<unknown>) => {
      const transaction = { ...store, $queryRaw: vi.fn().mockResolvedValue([]) };
      return operation(transaction);
    }),
  };
  return { prisma, service: new NotificationService(prisma as never, () => new Date('2026-09-04T12:00:00.000Z')) };
}

describe('NotificationService', () => {
  it('lists only the current tenant and user and clamps the limit', async () => {
    const { prisma, service } = createHarness();
    prisma.userNotification.findMany.mockResolvedValue([{ id: 'notification-1' }]);
    prisma.userNotification.count.mockResolvedValue(3);

    await expect(service.list(tenantId, 'user-a', 500)).resolves.toEqual({ items: [{ id: 'notification-1' }], unreadCount: 3 });
    expect(prisma.userNotification.findMany).toHaveBeenCalledWith({
      where: { tenantId, userId: 'user-a' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
      select: expect.any(Object),
    });
    expect(prisma.userNotification.count).toHaveBeenCalledWith({ where: { tenantId, userId: 'user-a', readAt: null } });
  });

  it('marks one notification read without crossing tenant or user boundaries', async () => {
    const { prisma, service } = createHarness();
    await expect(service.markRead(tenantId, 'user-a', '11111111-1111-4111-8111-111111111111')).resolves.toEqual({ updated: true });
    expect(prisma.userNotification.updateMany).toHaveBeenCalledWith({
      where: { id: '11111111-1111-4111-8111-111111111111', tenantId, userId: 'user-a', readAt: null },
      data: { readAt: new Date('2026-09-04T12:00:00.000Z') },
    });
  });

  it('marks all current-user notifications read', async () => {
    const { prisma, service } = createHarness();
    await expect(service.markAllRead(tenantId, 'user-a')).resolves.toEqual({ updatedCount: 1 });
    expect(prisma.userNotification.updateMany).toHaveBeenCalledWith({
      where: { tenantId, userId: 'user-a', readAt: null },
      data: { readAt: new Date('2026-09-04T12:00:00.000Z') },
    });
  });

  it.each(['https://evil.example', '//evil.example/path', '/admin', 'orders/1'])('rejects unsafe action URL %s', async (actionUrl) => {
    const { service } = createHarness();
    await expect(service.create({ tenantId, userId: 'user-a', type: 'INFO', category: 'TEST', title: 'Test', actionUrl })).rejects.toThrow('Invalid notification action URL');
  });

  it.each(['/orders/11111111-1111-4111-8111-111111111111', '/settings?tab=data', '/catalogue'])('accepts safe action URL %s', async (actionUrl) => {
    const { prisma, service } = createHarness();
    await service.create({ tenantId, userId: 'user-a', type: 'SUCCESS', category: 'TEST', title: 'Готово', actionUrl });
    expect(prisma.userNotification.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId, userId: 'user-a', actionUrl }) });
  });
});
