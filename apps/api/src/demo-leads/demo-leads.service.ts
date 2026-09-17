import type { DemoLeadInput } from '@autosale/contracts';
import { Prisma, type PrismaClient } from '@autosale/database';

import type { DemoLeadNotifier } from './demo-lead-notifier.js';

export class DemoLeadsService {
  constructor(private readonly prisma: PrismaClient, private readonly notifier: DemoLeadNotifier) {}

  async create(input: DemoLeadInput, idempotencyKey: string): Promise<{ id: string; accepted: true }> {
    let lead;
    try {
      lead = await this.prisma.demoLead.create({ data: { idempotencyKey, name: input.name, company: input.company, email: input.email || null, phone: input.phone || null, orderVolume: input.orderVolume, note: input.note || null, locale: input.locale } });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      lead = await this.prisma.demoLead.findUniqueOrThrow({ where: { idempotencyKey } });
    }

    if (lead.notificationStatus === 'PENDING') {
      try {
        await this.notifier.send(lead);
        await this.prisma.demoLead.update({ where: { id: lead.id }, data: { notificationStatus: 'SENT', notificationAttempts: { increment: 1 }, notifiedAt: new Date(), lastNotificationError: null } });
      } catch {
        await this.prisma.demoLead.update({ where: { id: lead.id }, data: { notificationStatus: 'FAILED', notificationAttempts: { increment: 1 }, lastNotificationError: 'DELIVERY_FAILED' } });
      }
    }
    return { id: lead.id, accepted: true };
  }
}
