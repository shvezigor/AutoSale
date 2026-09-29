interface PendingEventStore {
  webhookEvent: {
    findMany(input: {
      where: { provider: 'META'; status: 'RECEIVED' };
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }];
      take: number;
      select: { id: true };
    }): Promise<Array<{ id: string }>>;
  };
  $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

interface NormalizeQueue {
  add(
    name: 'instagram.normalize',
    data: { eventId: string; correlationId: string },
    options: { jobId: string; removeOnComplete: true; removeOnFail: true },
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
      this.store.$queryRaw<Array<{ event_id: string }>>`
        SELECT event_id
        FROM public.worker_instagram_attachment_backfill_events(100)
      `,
    ]);
    let failed = 0;

    for (const event of pending) {
      try {
        await this.queue.add(
          'instagram.normalize',
          { eventId: event.id, correlationId: event.id },
          { jobId: event.id, removeOnComplete: true, removeOnFail: true },
        );
      } catch {
        failed += 1;
      }
    }

    const pendingIds = new Set(pending.map((event) => event.id));
    for (const message of attachmentBackfills) {
      const eventId = message.event_id;
      if (pendingIds.has(eventId)) continue;

      try {
        await this.queue.add(
          'instagram.normalize',
          { eventId, correlationId: eventId },
          { jobId: `instagram-attachment-backfill-v2-${eventId}`, removeOnComplete: true, removeOnFail: true },
        );
      } catch {
        failed += 1;
      }
    }

    const uniqueBackfills = attachmentBackfills.filter(
      (message) => !pendingIds.has(message.event_id),
    ).length;
    return { attempted: pending.length + uniqueBackfills, failed };
  }
}
