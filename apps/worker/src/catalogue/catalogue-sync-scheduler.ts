import type { PrismaClient } from '@autosale/database';

type CatalogueQueue = { add(name: string, data: { tenantId: string; sourceId: string }, options?: Record<string, unknown>): Promise<unknown> };

export class CatalogueSyncScheduler {
  constructor(private readonly prisma: PrismaClient, private readonly queue: CatalogueQueue) {}

  async scheduleDue(now = new Date()): Promise<{ attempted: number }> {
    let cursor: string | undefined;
    let attempted = 0;
    do {
      const sources = await this.prisma.$queryRaw<Array<{ tenant_id: string; source_id: string; sync_schedule: string }>>`
        SELECT tenant_id, source_id, sync_schedule
        FROM public.worker_due_catalogue_sources(${now}, ${cursor ?? null}::uuid, ${100})
      `;
      for (const source of sources) {
        const interval = source.sync_schedule === 'HOURLY' ? 60 * 60_000 : 24 * 60 * 60_000;
        const bucket = Math.floor(now.getTime() / interval);
        await this.queue.add('catalogue.sync', { tenantId: source.tenant_id, sourceId: source.source_id }, {
          jobId: `catalogue.sync:${source.source_id}:${bucket}`, attempts: 5, backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: true, removeOnFail: 5_000,
        });
        attempted += 1;
      }
      cursor = sources.length === 100 ? sources[99]?.source_id : undefined;
    } while (cursor);
    return { attempted };
  }
}
