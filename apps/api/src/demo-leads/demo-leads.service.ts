import type { DemoLeadInput } from '@autosale/contracts';
import { Prisma, type PrismaClient } from '@autosale/database';
import type { Queue } from 'bullmq';

export class DemoLeadsService {
  constructor(private readonly prisma: PrismaClient, private readonly queue: Pick<Queue, 'add'>) {}

  async create(input: DemoLeadInput, idempotencyKey: string): Promise<{ id: string; accepted: true }> {
    let lead;
    try {
      lead = await this.prisma.demoLead.create({ data: { idempotencyKey, name: input.name, company: input.company, email: input.email || null, phone: input.phone || null, orderVolume: input.orderVolume, note: input.note || null, locale: input.locale, notificationNextAttemptAt: new Date() } });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      lead = await this.prisma.demoLead.findUniqueOrThrow({ where: { idempotencyKey } });
    }

    if (lead.notificationStatus === 'PENDING' || (lead.notificationStatus === 'FAILED' && lead.notificationNextAttemptAt !== null)) {
      try {
        await this.queue.add('demo-lead.notify', { leadId: lead.id }, {
          jobId: `demo-lead-${lead.id}`, attempts: 1, removeOnComplete: 100, removeOnFail: 250,
        });
      } catch {
        // The committed PostgreSQL row remains authoritative; the worker reconciler restores a missed job.
      }
    }
    return { id: lead.id, accepted: true };
  }
}
