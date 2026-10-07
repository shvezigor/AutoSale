interface PendingEventStore {
  $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

interface NormalizeQueue {
  add(
    name: 'instagram.normalize' | 'facebook.normalize' | 'tiktok.normalize',
    data: { tenantId: string; eventId: string; correlationId: string },
    options: { jobId: string; removeOnComplete: true; removeOnFail: true },
  ): Promise<unknown>;
}

interface DueInstagramEvent {
  tenant_id: string;
  event_id: string;
  recovery_kind: 'RECEIVED' | 'ATTACHMENT_BACKFILL';
  job_name: 'instagram.normalize' | 'facebook.normalize' | 'tiktok.normalize';
}

type ControlledChannel = 'FACEBOOK_MESSENGER' | 'TIKTOK_BUSINESS_MESSAGING';

export class InstagramEventReconciler {
  constructor(
    private readonly store: PendingEventStore,
    private readonly queue: NormalizeQueue,
    private readonly isChannelEnabled: (key: ControlledChannel) => Promise<boolean>,
  ) {}

  async reconcile(): Promise<{ attempted: number; failed: number; skipped: number }> {
    const pending = await this.store.$queryRaw<DueInstagramEvent[]>`
      SELECT tenant_id, event_id, recovery_kind, job_name
      FROM public.worker_due_instagram_events(100)
    `;
    let failed = 0;
    let skipped = 0;

    for (const event of pending) {
      const key = event.job_name === 'facebook.normalize'
        ? 'FACEBOOK_MESSENGER'
        : event.job_name === 'tiktok.normalize'
          ? 'TIKTOK_BUSINESS_MESSAGING'
          : null;
      if (key && !await this.isChannelEnabled(key)) {
        skipped += 1;
        continue;
      }
      try {
        await this.queue.add(
          event.job_name,
          {
            tenantId: event.tenant_id,
            eventId: event.event_id,
            correlationId: event.event_id,
          },
          {
            jobId: event.recovery_kind === 'ATTACHMENT_BACKFILL'
              ? `instagram-attachment-backfill-v3-${event.event_id}`
              : event.event_id,
            removeOnComplete: true,
            removeOnFail: true,
          },
        );
      } catch {
        failed += 1;
      }
    }

    return { attempted: pending.length, failed, skipped };
  }
}
