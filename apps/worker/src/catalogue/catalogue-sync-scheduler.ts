import type { PrismaClient } from '@autosale/database';

type CatalogueQueue = { add(name: string, data: { tenantId: string; sourceId: string }, options?: Record<string, unknown>): Promise<unknown> };

export class CatalogueSyncScheduler {
  constructor(private readonly prisma: PrismaClient, private readonly queue: CatalogueQueue) {}

  async scheduleDue(now = new Date()): Promise<{ attempted: number }> {
    let cursor: string | undefined;
    let attempted = 0;
    do {
      const sources = await this.prisma.catalogueSource.findMany({
        where: { type: 'GOOGLE_SHEETS', status: 'ACTIVE', syncSchedule: { in: ['HOURLY', 'DAILY'] }, nextSyncAt: { lte: now } },
        orderBy: { id: 'asc' }, take: 100,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, tenantId: true, syncSchedule: true },
      });
      for (const source of sources) {
        const interval = source.syncSchedule === 'HOURLY' ? 60 * 60_000 : 24 * 60 * 60_000;
        const bucket = Math.floor(now.getTime() / interval);
        await this.queue.add('catalogue.sync', { tenantId: source.tenantId, sourceId: source.id }, {
          jobId: `catalogue.sync:${source.id}:${bucket}`, attempts: 5, backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: true, removeOnFail: 5_000,
        });
        attempted += 1;
      }
      cursor = sources.length === 100 ? sources[99]?.id : undefined;
    } while (cursor);
    return { attempted };
  }
}
