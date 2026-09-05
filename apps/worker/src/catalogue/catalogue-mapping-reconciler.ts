import type { PrismaClient } from '@autosale/database';

type MappingQueue = { add(name: string, data: { tenantId: string; runId: string }, options?: Record<string, unknown>): Promise<unknown> };

export class CatalogueMappingReconciler {
  constructor(private readonly prisma: PrismaClient, private readonly queue: MappingQueue) {}

  async reconcile(): Promise<{ attempted: number; enqueued: number }> {
    const now = new Date();
    const runs = await this.prisma.catalogueImportRun.findMany({
      where: {
        OR: [
          { status: 'UPLOADED' },
          { status: 'MAPPING', mappingLeaseId: { not: null }, mappingLeaseExpiresAt: { lt: now } },
        ],
      },
      select: { id: true, tenantId: true, updatedAt: true }, orderBy: { updatedAt: 'asc' }, take: 100,
    });
    let enqueued = 0;
    for (const run of runs) {
      try {
        await this.queue.add('catalogue.mapping', { tenantId: run.tenantId, runId: run.id }, {
          // A run can legitimately return to UPLOADED after its structure changes.
          // Version the queue id so a retained completed BullMQ job cannot block recovery.
          jobId: `catalogue.mapping:${run.id}:${run.updatedAt.getTime()}`, removeOnComplete: 1_000, removeOnFail: 5_000,
        });
        enqueued += 1;
      } catch {
        // The run remains the durable dispatch record and will be retried next poll.
      }
    }
    return { attempted: runs.length, enqueued };
  }
}
