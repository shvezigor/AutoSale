import { appendSecurityAudit, type PrismaClient } from '@autosale/database';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, PayloadTooLargeException, ServiceUnavailableException } from '@nestjs/common';

import type { AdminStepUpService } from './admin-step-up.service.js';

type Status = 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'CLOSED';
const nextStatuses: Record<Status, readonly Status[]> = {
  NEW: ['CONTACTED'], CONTACTED: ['QUALIFIED'], QUALIFIED: ['CLOSED'], CLOSED: ['CONTACTED'],
};

function maskedContact(email: string | null, phone: string | null): string {
  if (email) return `${email.slice(0, 1)}***@***`;
  if (phone) return `••••${phone.replace(/\D/g, '').slice(-2)}`;
  return '—';
}

export function safeCsvCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function csvCell(value: string | number | Date | null): string {
  const text = value instanceof Date ? value.toISOString() : String(value ?? '');
  return '"' + safeCsvCell(text).replaceAll('"', '""') + '"';
}

export class AdminDemoLeadsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit = appendSecurityAudit,
    private readonly stepUp?: Pick<AdminStepUpService, 'verify'>,
    private readonly erasureEnabled = false,
  ) {}

  private requireStepUp(token: string, adminId: string, sessionId: string, purpose: 'DEMO_LEAD_EXPORT' | 'DEMO_LEAD_DELETE') {
    if (!this.stepUp?.verify(token, adminId, sessionId, purpose)) throw new ForbiddenException('ADMIN_REAUTH_REQUIRED');
  }

  async exportOne(id: string, adminId: string, sessionId: string, token: string) {
    this.requireStepUp(token, adminId, sessionId, 'DEMO_LEAD_EXPORT');
    const lead = await this.prisma.demoLead.findUnique({ where: { id }, select: {
      id: true, name: true, company: true, email: true, phone: true, orderVolume: true,
      note: true, locale: true, consentVersion: true, consentedAt: true,
      lifecycleStatus: true, createdAt: true, updatedAt: true,
    } });
    if (!lead) throw new NotFoundException('DEMO_LEAD_NOT_FOUND');
    await this.audit(this.prisma, { tenantId: null, userId: adminId, actor: 'USER', action: 'DEMO_LEAD_EXPORTED', result: 'SUCCESS', metadata: { leadId: id } });
    return lead;
  }

  async exportCsv(filter: { from: string; to: string; status?: Status | undefined }, adminId: string, sessionId: string, token: string): Promise<string> {
    this.requireStepUp(token, adminId, sessionId, 'DEMO_LEAD_EXPORT');
    const start = new Date(`${filter.from}T00:00:00.000Z`);
    const end = new Date(`${filter.to}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    const lines = ['id,created_at,name,company,email,phone,order_volume,note,locale,status,consent_version,consented_at'];
    let cursor: string | undefined;
    let count = 0;
    for (;;) {
      const rows = await this.prisma.demoLead.findMany({
        where: { createdAt: { gte: start, lt: end }, ...(filter.status ? { lifecycleStatus: filter.status } : {}) },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 101,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, createdAt: true, name: true, company: true, email: true, phone: true,
          orderVolume: true, note: true, locale: true, lifecycleStatus: true, consentVersion: true, consentedAt: true },
      });
      if (!rows.length) break;
      if (count + rows.length > 1000) throw new PayloadTooLargeException('DEMO_LEAD_EXPORT_TOO_LARGE');
      for (const row of rows) lines.push([
        row.id, row.createdAt, row.name, row.company, row.email, row.phone, row.orderVolume,
        row.note, row.locale, row.lifecycleStatus, row.consentVersion, row.consentedAt,
      ].map(csvCell).join(','));
      count += rows.length;
      if (rows.length < 101) break;
      cursor = rows.at(-1)!.id;
    }
    await this.audit(this.prisma, { tenantId: null, userId: adminId, actor: 'USER', action: 'DEMO_LEADS_CSV_EXPORTED', result: 'SUCCESS', metadata: { from: filter.from, to: filter.to, status: filter.status ?? 'ALL', count } });
    return `\uFEFF${lines.join('\r\n')}\r\n`;
  }

  async deleteOne(id: string, confirmId: string, adminId: string, sessionId: string, token: string): Promise<{ deleted: true }> {
    if (!this.erasureEnabled) throw new ServiceUnavailableException('DEMO_LEAD_ERASURE_DISABLED');
    this.requireStepUp(token, adminId, sessionId, 'DEMO_LEAD_DELETE');
    if (confirmId !== id) throw new BadRequestException('DEMO_LEAD_CONFIRM_ID');
    return this.prisma.$transaction(async (tx) => {
      const lead = await tx.demoLead.findUnique({ where: { id }, select: { notificationLeaseId: true, notificationLeaseExpiresAt: true } });
      if (!lead) throw new NotFoundException('DEMO_LEAD_NOT_FOUND');
      const now = new Date();
      if (lead.notificationLeaseId && (!lead.notificationLeaseExpiresAt || lead.notificationLeaseExpiresAt > now)) {
        throw new ConflictException('DEMO_LEAD_NOTIFICATION_BUSY');
      }
      const deleted = await tx.demoLead.deleteMany({ where: {
        id, OR: [{ notificationLeaseId: null }, { notificationLeaseExpiresAt: { lte: now } }],
      } });
      if (deleted.count !== 1) throw new ConflictException('DEMO_LEAD_NOTIFICATION_BUSY');
      await this.audit(tx, { tenantId: null, userId: adminId, actor: 'USER', action: 'DEMO_LEAD_DELETED', result: 'SUCCESS', metadata: { leadId: id, reason: 'CONTROLLER_REQUEST' } });
      return { deleted: true };
    });
  }

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
      deletionAvailable: this.erasureEnabled,
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
