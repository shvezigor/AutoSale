import { appendSecurityAudit, type PrismaClient } from '@autosale/database';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

type Status = 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'CLOSED';
const nextStatuses: Record<Status, readonly Status[]> = {
  NEW: ['CONTACTED'], CONTACTED: ['QUALIFIED'], QUALIFIED: ['CLOSED'], CLOSED: ['CONTACTED'],
};

function maskedContact(email: string | null, phone: string | null): string {
  if (email) return `${email.slice(0, 1)}***@***`;
  if (phone) return `••••${phone.replace(/\D/g, '').slice(-2)}`;
  return '—';
}

export class AdminDemoLeadsService {
  constructor(private readonly prisma: PrismaClient, private readonly audit = appendSecurityAudit) {}

  async list(input: { limit?: number | undefined; status?: Status | undefined; cursor?: string | undefined }) {
    const limit = Math.min(50, Math.max(1, input.limit ?? 25));
    const rows = await this.prisma.demoLead.findMany({
      ...(input.status ? { where: { lifecycleStatus: input.status } } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      select: { id: true, company: true, email: true, phone: true, lifecycleStatus: true, notificationStatus: true, createdAt: true, version: true },
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map((row) => ({
        id: row.id, company: row.company, maskedContact: maskedContact(row.email, row.phone),
        status: row.lifecycleStatus, notificationStatus: row.notificationStatus,
        createdAt: row.createdAt.toISOString(), version: row.version,
      })),
      nextCursor: rows.length > limit ? page.at(-1)?.id ?? null : null,
    };
  }

  async detail(id: string, adminId: string) {
    const row = await this.prisma.demoLead.findUnique({
      where: { id },
      select: {
        id: true, name: true, company: true, email: true, phone: true, orderVolume: true, note: true,
        locale: true, consentVersion: true, consentedAt: true, lifecycleStatus: true, notificationStatus: true,
        createdAt: true, updatedAt: true, version: true, lastOperatorActionAt: true,
      },
    });
    if (!row) return null;
    await this.audit(this.prisma, { tenantId: null, userId: adminId, actor: 'USER', action: 'DEMO_LEAD_DETAIL_ACCESSED', result: 'SUCCESS', metadata: { leadId: id } });
    return {
      id: row.id, name: row.name, company: row.company, email: row.email, phone: row.phone,
      orderVolume: row.orderVolume, note: row.note, locale: row.locale, consentVersion: row.consentVersion,
      consentedAt: row.consentedAt.toISOString(), status: row.lifecycleStatus, notificationStatus: row.notificationStatus,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), version: row.version,
      lastOperatorActionAt: row.lastOperatorActionAt?.toISOString() ?? null,
    };
  }

  async changeStatus(id: string, status: Status, expectedVersion: number, adminId: string): Promise<{ id: string; status: Status; version: number }> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.demoLead.findUnique({ where: { id }, select: { lifecycleStatus: true, version: true } });
      if (!current) throw new NotFoundException('DEMO_LEAD_NOT_FOUND');
      if (current.version !== expectedVersion) throw new ConflictException('DEMO_LEAD_CHANGED');
      if (!nextStatuses[current.lifecycleStatus].includes(status)) throw new BadRequestException('DEMO_LEAD_TRANSITION_INVALID');
      const changed = await tx.demoLead.updateMany({
        where: { id, version: expectedVersion, lifecycleStatus: current.lifecycleStatus },
        data: { lifecycleStatus: status, version: { increment: 1 }, lastOperatorActionAt: new Date() },
      });
      if (changed.count !== 1) throw new ConflictException('DEMO_LEAD_CHANGED');
      await this.audit(tx, { tenantId: null, userId: adminId, actor: 'USER', action: 'DEMO_LEAD_STATUS_CHANGED', result: 'SUCCESS', metadata: { leadId: id, from: current.lifecycleStatus, to: status } });
      return { id, status, version: expectedVersion + 1 };
    });
  }
}
