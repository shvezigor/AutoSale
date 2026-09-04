import { BadRequestException } from '@nestjs/common';

type NotificationType = 'SUCCESS' | 'ERROR' | 'WARNING' | 'INFO';
type NotificationStore = {
  userNotification: {
    create(args: unknown): Promise<unknown>;
    findMany(args: unknown): Promise<unknown[]>;
    count(args: unknown): Promise<number>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
};

export type CreateNotificationInput = {
  tenantId: string;
  userId: string;
  type: NotificationType;
  category: string;
  title: string;
  message?: string;
  actionUrl?: string;
};

const notificationSelect = {
  id: true,
  type: true,
  category: true,
  title: true,
  message: true,
  actionUrl: true,
  readAt: true,
  createdAt: true,
} as const;

export class NotificationService {
  constructor(
    private readonly prisma: NotificationStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(input: CreateNotificationInput): Promise<void> {
    if (input.actionUrl !== undefined && !isSafeActionUrl(input.actionUrl)) {
      throw new BadRequestException('Invalid notification action URL');
    }
    await this.prisma.userNotification.create({ data: input });
  }

  async list(tenantId: string, userId: string, requestedLimit = 20) {
    const limit = Math.min(50, Math.max(1, Number.isFinite(requestedLimit) ? Math.trunc(requestedLimit) : 20));
    const where = { tenantId, userId };
    const [items, unreadCount] = await Promise.all([
      this.prisma.userNotification.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit, select: notificationSelect }),
      this.prisma.userNotification.count({ where: { ...where, readAt: null } }),
    ]);
    return { items, unreadCount };
  }

  async markRead(tenantId: string, userId: string, id: string): Promise<{ updated: boolean }> {
    const result = await this.prisma.userNotification.updateMany({
      where: { id, tenantId, userId, readAt: null },
      data: { readAt: this.now() },
    });
    return { updated: result.count > 0 };
  }

  async markAllRead(tenantId: string, userId: string): Promise<{ updatedCount: number }> {
    const result = await this.prisma.userNotification.updateMany({
      where: { tenantId, userId, readAt: null },
      data: { readAt: this.now() },
    });
    return { updatedCount: result.count };
  }
}

function isSafeActionUrl(value: string): boolean {
  if (!value.startsWith('/') || value.startsWith('//')) return false;
  const pathname = value.split(/[?#]/, 1)[0] ?? '';
  return ['/conversations', '/orders', '/catalogue', '/team', '/settings']
    .some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
