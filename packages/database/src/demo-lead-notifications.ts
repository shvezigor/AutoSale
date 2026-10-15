import { randomUUID } from 'node:crypto';

import type { PrismaClient } from './generated/prisma/client.js';

export type DemoLeadNotificationClaim = {
  id: string;
  name: string;
  company: string;
  email: string | null;
  phone: string | null;
  orderVolume: string;
  note: string | null;
  locale: string;
  leaseId: string;
  attempt: number;
};

export type DemoLeadFailureCode = 'DELIVERY_FAILED' | 'RECIPIENT_REJECTED' | 'NOT_CONFIGURED' | 'DELIVERY_UNKNOWN';

export class DemoLeadNotificationStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async claim(id: string): Promise<DemoLeadNotificationClaim | null> {
    const now = this.now();
    const leaseId = randomUUID();
    const updated = await this.prisma.demoLead.updateMany({
      where: {
        id,
        notificationStatus: { in: ['PENDING', 'FAILED'] },
        notificationAttempts: { lt: 4 },
        notificationNextAttemptAt: { lte: now },
        OR: [{ notificationLeaseId: null }, { notificationLeaseExpiresAt: { lte: now } }],
      },
      data: {
        notificationLeaseId: leaseId,
        notificationLeaseExpiresAt: new Date(now.getTime() + 120_000),
        notificationAttempts: { increment: 1 },
      },
    });
    if (updated.count === 0) return null;
    const lead = await this.prisma.demoLead.findFirst({ where: { id, notificationLeaseId: leaseId } });
    if (!lead) return null;
    return {
      id: lead.id,
      name: lead.name,
      company: lead.company,
      email: lead.email,
      phone: lead.phone,
      orderVolume: lead.orderVolume,
      note: lead.note,
      locale: lead.locale,
      leaseId,
      attempt: lead.notificationAttempts,
    };
  }

  async markSent(id: string, leaseId: string): Promise<boolean> {
    const updated = await this.prisma.demoLead.updateMany({
      where: { id, notificationLeaseId: leaseId, notificationStatus: { in: ['PENDING', 'FAILED'] } },
      data: {
        notificationStatus: 'SENT',
        notifiedAt: this.now(),
        notificationNextAttemptAt: null,
        notificationLeaseId: null,
        notificationLeaseExpiresAt: null,
        lastNotificationError: null,
      },
    });
    return updated.count === 1;
  }

  async markFailed(id: string, leaseId: string, code: DemoLeadFailureCode, terminal: boolean): Promise<Date | null> {
    const lead = await this.prisma.demoLead.findFirst({
      where: { id, notificationLeaseId: leaseId, notificationStatus: { in: ['PENDING', 'FAILED'] } },
      select: { notificationAttempts: true },
    });
    if (!lead) return null;
    const delays = [60_000, 300_000, 900_000] as const;
    const dueAt = terminal || lead.notificationAttempts >= 4
      ? null
      : new Date(this.now().getTime() + delays[lead.notificationAttempts - 1]!);
    const updated = await this.prisma.demoLead.updateMany({
      where: { id, notificationLeaseId: leaseId, notificationStatus: { in: ['PENDING', 'FAILED'] } },
      data: {
        notificationStatus: 'FAILED',
        notificationNextAttemptAt: dueAt,
        notificationLeaseId: null,
        notificationLeaseExpiresAt: null,
        lastNotificationError: code,
      },
    });
    return updated.count === 1 ? dueAt : null;
  }

  async counts(): Promise<{ due: number; exhausted: number }> {
    const now = this.now();
    const [due, exhausted] = await Promise.all([
      this.prisma.demoLead.count({ where: {
        notificationStatus: { in: ['PENDING', 'FAILED'] },
        notificationAttempts: { lt: 4 },
        notificationNextAttemptAt: { lte: now },
        OR: [{ notificationLeaseId: null }, { notificationLeaseExpiresAt: { lte: now } }],
      } }),
      this.prisma.demoLead.count({ where: {
        notificationStatus: 'FAILED', notificationNextAttemptAt: null,
      } }),
    ]);
    return { due, exhausted };
  }

  async listDue(limit: number): Promise<string[]> {
    const rows = await this.prisma.demoLead.findMany({
      where: {
        notificationStatus: { in: ['PENDING', 'FAILED'] },
        notificationAttempts: { lt: 4 },
        notificationNextAttemptAt: { lte: this.now() },
        OR: [{ notificationLeaseId: null }, { notificationLeaseExpiresAt: { lte: this.now() } }],
      },
      orderBy: [{ notificationNextAttemptAt: 'asc' }, { id: 'asc' }],
      take: Math.min(Math.max(limit, 1), 50),
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async finalizeExpiredLeases(): Promise<number> {
    const updated = await this.prisma.demoLead.updateMany({
      where: {
        notificationStatus: { in: ['PENDING', 'FAILED'] },
        notificationAttempts: { gte: 4 },
        notificationLeaseId: { not: null },
        notificationLeaseExpiresAt: { lte: this.now() },
      },
      data: {
        notificationStatus: 'FAILED',
        notificationNextAttemptAt: null,
        notificationLeaseId: null,
        notificationLeaseExpiresAt: null,
        lastNotificationError: 'DELIVERY_UNKNOWN',
      },
    });
    return updated.count;
  }
}
