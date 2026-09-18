interface PendingEventStore {
  webhookEvent: {
    findMany(input: {
      where: { provider: 'META'; status: 'RECEIVED' };
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }];
      take: number;
      select: { id: true };
    }): Promise<Array<{ id: string }>>;
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
    const pending = await this.store.webhookEvent.findMany({
      where: { provider: 'META', status: 'RECEIVED' },
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
      take: 100,
      select: { id: true },
    });
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

    return { attempted: pending.length, failed };
  }
}
