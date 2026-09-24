interface PendingEventStore {
  webhookEvent: {
    findMany(input: {
      where: { provider: 'META'; status: 'RECEIVED' };
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }];
      take: number;
      select: { id: true };
    }): Promise<Array<{ id: string }>>;
  };
  message: {
    findMany(input: {
      where: {
        channel: 'INSTAGRAM';
        text: null;
        rawEventId: { not: null };
        attachments: { none: Record<string, never> };
      };
      distinct: ['rawEventId'];
      orderBy: [{ sourceTimestamp: 'asc' }, { id: 'asc' }];
      take: number;
      select: { rawEventId: true };
    }): Promise<Array<{ rawEventId: string | null }>>;
  };
}

interface NormalizeQueue {
  add(
    name: 'instagram.normalize',
    data: { eventId: string; correlationId: string },
    options: { jobId: string; removeOnFail: true },
  ): Promise<unknown>;
}

export class InstagramEventReconciler {
  constructor(
    private readonly store: PendingEventStore,
    private readonly queue: NormalizeQueue,
  ) {}

  async reconcile(): Promise<{ attempted: number; failed: number }> {
    const [pending, attachmentBackfills] = await Promise.all([
      this.store.webhookEvent.findMany({
        where: { provider: 'META', status: 'RECEIVED' },
        orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
        take: 100,
        select: { id: true },
      }),
      this.store.message.findMany({
        where: {
          channel: 'INSTAGRAM',
          text: null,
          rawEventId: { not: null },
          attachments: { none: {} },
        },
        distinct: ['rawEventId'],
        orderBy: [{ sourceTimestamp: 'asc' }, { id: 'asc' }],
        take: 100,
        select: { rawEventId: true },
      }),
    ]);
    let failed = 0;

    for (const event of pending) {
      try {
        await this.queue.add(
          'instagram.normalize',
          { eventId: event.id, correlationId: event.id },
          { jobId: event.id, removeOnFail: true },
        );
      } catch {
        failed += 1;
      }
    }

    const pendingIds = new Set(pending.map((event) => event.id));
    for (const message of attachmentBackfills) {
      const eventId = message.rawEventId;
      if (!eventId || pendingIds.has(eventId)) continue;

      try {
        await this.queue.add(
          'instagram.normalize',
          { eventId, correlationId: eventId },
          { jobId: `instagram-attachment-backfill-${eventId}`, removeOnFail: true },
        );
      } catch {
        failed += 1;
      }
    }

    const uniqueBackfills = attachmentBackfills.filter(
      (message) => message.rawEventId && !pendingIds.has(message.rawEventId),
    ).length;
    return { attempted: pending.length + uniqueBackfills, failed };
  }
}
