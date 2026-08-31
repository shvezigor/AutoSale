import type { PrismaClient } from '@autosale/database';

import { CATALOGUE_MAPPING_LEASE_MS } from './catalogue-mapping.processor.js';

type MappingQueue = { add(name: string, data: { tenantId: string; runId: string }, options?: Record<string, unknown>): Promise<unknown> };

export class CatalogueMappingReconciler {
  constructor(private readonly prisma: PrismaClient, private readonly queue: MappingQueue) {}

  async reconcile(): Promise<{ attempted: number; enqueued: number }> {
    const staleBefore = new Date(Date.now() - CATALOGUE_MAPPING_LEASE_MS);
    const runs = await this.prisma.catalogueImportRun.findMany({
      where: { OR: [{ status: 'UPLOADED' }, { status: 'MAPPING', updatedAt: { lt: staleBefore } }] },
      select: { id: true, tenantId: true }, orderBy: { updatedAt: 'asc' }, take: 100,
    });
    let enqueued = 0;
    for (const run of runs) {
      try {
        await this.queue.add('catalogue.mapping', { tenantId: run.tenantId, runId: run.id }, {
          jobId: `catalogue.mapping:${run.id}`, removeOnComplete: 1_000, removeOnFail: 5_000,
        });
        enqueued += 1;
      } catch {
        // The run remains the durable dispatch record and will be retried next poll.
      }
    }
    return { attempted: runs.length, enqueued };
  }
}
