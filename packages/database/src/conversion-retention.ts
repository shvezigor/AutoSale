import type { PrismaClient } from './generated/prisma/client.js';

export class ConversionRetentionStore {
  constructor(private readonly prisma: PrismaClient) {}

  async purgeDue(now: Date, limit = 100): Promise<{ interestsDeleted: number; countersDeleted: number }> {
    const bounded = Math.min(Math.max(Math.trunc(limit), 1), 100);
    const rows = await this.prisma.$queryRaw<Array<{ interests_deleted: number; counters_deleted: number }>>`
      SELECT interests_deleted, counters_deleted FROM public.worker_purge_conversion_data(${now}, ${bounded})
    `;
    if (!rows[0]) throw new Error('Conversion retention function returned no result');
    return { interestsDeleted: rows[0].interests_deleted, countersDeleted: rows[0].counters_deleted };
  }
}
