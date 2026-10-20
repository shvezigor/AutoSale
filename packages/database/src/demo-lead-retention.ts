import type { PrismaClient } from './generated/prisma/client.js';

export class DemoLeadRetentionStore {
  constructor(private readonly prisma: PrismaClient) {}

  async purgeDue(now: Date, limit: number): Promise<{ purged: number; busy: number }> {
    const rows = await this.prisma.$queryRaw<Array<{ purged: number; busy: number }>>`
      SELECT purged, busy FROM public.worker_purge_expired_demo_leads(
        ${now}, ${Math.min(Math.max(Math.trunc(limit), 1), 100)}
      )
    `;
    if (!rows[0]) throw new Error('Demo lead retention function returned no result');
    return rows[0];
  }
}
