import type { PrismaClient } from '@autosale/database';

type MappingQueue = { add(name: string, data: { tenantId: string; runId: string }, options?: Record<string, unknown>): Promise<unknown> };

export class CatalogueMappingReconciler {
  constructor(private readonly prisma: PrismaClient, private readonly queue: MappingQueue) {}

  async reconcile(): Promise<{ attempted: number; enqueued: number }> {
    const now = new Date();
    const runs = await this.prisma.$queryRaw<Array<{ tenant_id: string; run_id: string; updated_at: Date }>>`
      SELECT tenant_id, run_id, updated_at
      FROM public.worker_due_catalogue_mapping_runs(${now}, ${100})
    `;
    let enqueued = 0;
    for (const run of runs) {
      try {
        await this.queue.add('catalogue.mapping', { tenantId: run.tenant_id, runId: run.run_id }, {
          // A run can legitimately return to UPLOADED after its structure changes.
          // Version the queue id so a retained completed BullMQ job cannot block recovery.
          jobId: `catalogue.mapping:${run.run_id}:${run.updated_at.getTime()}`, removeOnComplete: 1_000, removeOnFail: 5_000,
        });
        enqueued += 1;
      } catch {
        // The run remains the durable dispatch record and will be retried next poll.
      }
    }
    return { attempted: runs.length, enqueued };
  }
}
