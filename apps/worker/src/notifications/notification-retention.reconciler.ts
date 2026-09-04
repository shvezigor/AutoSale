const RETENTION_DAYS = 90;
const RETENTION_BATCH_SIZE = 1_000;
const DAY_MS = 24 * 60 * 60_000;

type NotificationStore = {
  userNotification: {
    findMany(input: unknown): Promise<Array<{ id: string }>>;
    deleteMany(input: unknown): Promise<{ count: number }>;
  };
};

export class NotificationRetentionReconciler {
  constructor(private readonly prisma: NotificationStore) {}

  async reconcile(now = new Date()): Promise<number> {
    const expired = await this.prisma.userNotification.findMany({
      where: { createdAt: { lt: new Date(now.getTime() - RETENTION_DAYS * DAY_MS) } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: RETENTION_BATCH_SIZE,
    });
    if (expired.length === 0) return 0;

    const result = await this.prisma.userNotification.deleteMany({
      where: { id: { in: expired.map(({ id }) => id) } },
    });
    return result.count;
  }
}
