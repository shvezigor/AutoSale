import { describe, expect, it, vi } from 'vitest';

import { AdminDemoLeadsService, safeCsvCell } from './admin-demo-leads.service.js';

const adminId = '11111111-1111-4111-8111-111111111111';
const leadId = '22222222-2222-4222-8222-222222222222';
const createdAt = new Date('2026-10-20T10:00:00.000Z');
const lead = {
  id: leadId, name: 'Fictional Olena', company: 'Fictional Shop', email: 'olena@example.test', phone: '+380 67 123 45 67',
  note: 'Clearly fictional note', orderVolume: 'UNDER_50', locale: 'en', consentVersion: '2026-09-17', consentedAt: createdAt,
  lifecycleStatus: 'NEW', notificationStatus: 'PENDING', createdAt, updatedAt: createdAt, version: 0, lastOperatorActionAt: null,
};

describe('AdminDemoLeadsService', () => {
  it('lists a capped page with masked contact and without the note', async () => {
    const findMany = vi.fn().mockResolvedValue([lead]);
    const service = new AdminDemoLeadsService({ demoLead: { findMany } } as never);
    const result = await service.list({ limit: 1000, status: 'NEW' });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 51, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: leadId, company: 'Fictional Shop', status: 'NEW' });
    expect(JSON.stringify(result)).not.toContain('olena@example.test');
    expect(JSON.stringify(result)).not.toContain('Clearly fictional note');
  });

  it('withholds lead detail if the access audit fails', async () => {
    const audit = vi.fn().mockRejectedValue(new Error('audit failed'));
    const service = new AdminDemoLeadsService({ demoLead: { findUnique: vi.fn().mockResolvedValue(lead) } } as never, audit);
    await expect(service.detail(leadId, adminId)).rejects.toThrow('audit failed');
  });

  it('changes status and appends minimal audit inside one transaction', async () => {
    const tx = { demoLead: {
      findUnique: vi.fn().mockResolvedValue(lead),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    } };
    const prisma = { $transaction: vi.fn(async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx)) };
    const audit = vi.fn().mockResolvedValue(undefined);
    const service = new AdminDemoLeadsService(prisma as never, audit);
    await expect(service.changeStatus(leadId, 'CONTACTED', 0, adminId)).resolves.toEqual({ id: leadId, status: 'CONTACTED', version: 1 });
    expect(tx.demoLead.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: leadId, version: 0, lifecycleStatus: 'NEW' } }));
    expect(audit).toHaveBeenCalledWith(tx, { tenantId: null, userId: adminId, actor: 'USER', action: 'DEMO_LEAD_STATUS_CHANGED', result: 'SUCCESS', metadata: { leadId, from: 'NEW', to: 'CONTACTED' } });
  });

  it('rejects stale versions without writing an audit', async () => {
    const tx = { demoLead: { findUnique: vi.fn().mockResolvedValue(lead), updateMany: vi.fn().mockResolvedValue({ count: 0 }) } };
    const audit = vi.fn();
    const service = new AdminDemoLeadsService({ $transaction: (operation: (client: typeof tx) => Promise<unknown>) => operation(tx) } as never, audit);
    await expect(service.changeStatus(leadId, 'CONTACTED', 0, adminId)).rejects.toMatchObject({ status: 409 });
    expect(audit).not.toHaveBeenCalled();
  });

  it('allows only the explicit workflow and reopens CLOSED as CONTACTED', async () => {
    const tx = { demoLead: { findUnique: vi.fn().mockResolvedValue({ ...lead, lifecycleStatus: 'CLOSED' }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
    const service = new AdminDemoLeadsService({ $transaction: (operation: (client: typeof tx) => Promise<unknown>) => operation(tx) } as never, vi.fn());
    await expect(service.changeStatus(leadId, 'QUALIFIED', 0, adminId)).rejects.toMatchObject({ status: 400 });
    await expect(service.changeStatus(leadId, 'CONTACTED', 0, adminId)).resolves.toMatchObject({ status: 'CONTACTED' });
  });

  it('exports one lead only with an export-purpose step-up and audits before releasing contact', async () => {
    const audit = vi.fn().mockResolvedValue(undefined);
    const findUnique = vi.fn().mockResolvedValue(lead);
    const stepUp = { verify: vi.fn((_token, _user, _session, purpose) => purpose === 'DEMO_LEAD_EXPORT') };
    const service = new AdminDemoLeadsService({ demoLead: { findUnique } } as never, audit, stepUp as never);
    await expect(service.exportOne(leadId, adminId, 'session-a', 'token')).resolves.toMatchObject({ id: leadId, email: 'olena@example.test' });
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'DEMO_LEAD_EXPORTED', metadata: { leadId } }));
    stepUp.verify.mockReturnValue(false);
    await expect(service.exportOne(leadId, adminId, 'session-a', 'wrong-purpose')).rejects.toMatchObject({ status: 403 });
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('deletes a confirmed lead and audits atomically, but refuses an active notification lease', async () => {
    const row = { ...lead, notificationLeaseId: null, notificationLeaseExpiresAt: null };
    const tx = { demoLead: { findUnique: vi.fn().mockResolvedValue(row), deleteMany: vi.fn().mockResolvedValue({ count: 1 }) } };
    const prisma = { $transaction: vi.fn(async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx)) };
    const audit = vi.fn().mockResolvedValue(undefined);
    const stepUp = { verify: vi.fn().mockReturnValue(true) };
    const service = new AdminDemoLeadsService(prisma as never, audit, stepUp as never, true);
    await expect(service.deleteOne(leadId, leadId, adminId, 'session-a', 'token')).resolves.toEqual({ deleted: true });
    expect(tx.demoLead.deleteMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: leadId }) }));
    expect(audit).toHaveBeenCalledWith(tx, expect.objectContaining({ action: 'DEMO_LEAD_DELETED', metadata: { leadId, reason: 'CONTROLLER_REQUEST' } }));
    await expect(service.deleteOne(leadId, 'wrong-id', adminId, 'session-a', 'token')).rejects.toMatchObject({ status: 400 });
    tx.demoLead.findUnique.mockResolvedValue({ ...row, notificationLeaseId: '33333333-3333-4333-8333-333333333333', notificationLeaseExpiresAt: new Date(Date.now() + 60_000) });
    await expect(service.deleteOne(leadId, leadId, adminId, 'session-a', 'token')).rejects.toMatchObject({ status: 409 });
  });

  it('fails closed for deletion until the erasure recovery gate is enabled', async () => {
    const service = new AdminDemoLeadsService({} as never, vi.fn(), { verify: () => true } as never);
    await expect(service.deleteOne(leadId, leadId, adminId, 'session-a', 'token')).rejects.toMatchObject({ status: 503 });
  });

  it('escapes spreadsheet formulas and bounds the CSV export', async () => {
    expect(safeCsvCell('=HYPERLINK("https://example.test")')).toBe("'=HYPERLINK(\"https://example.test\")");
    expect(safeCsvCell('+SUM(1,2)')).toBe("'+SUM(1,2)");
    expect(safeCsvCell('\tcmd')).toBe("'\tcmd");
    const findMany = vi.fn().mockResolvedValueOnce([{ ...lead, name: '=fictional', note: 'line\nbreak' }]).mockResolvedValueOnce([]);
    const audit = vi.fn();
    const service = new AdminDemoLeadsService({ demoLead: { findMany } } as never, audit, { verify: () => true } as never);
    const csv = await service.exportCsv({ from: '2026-10-01', to: '2026-10-31', status: 'NEW' }, adminId, 'session-a', 'token');
    expect(csv).toContain('"\'=fictional"');
    expect(csv).toContain('"line\nbreak"');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 101, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }));
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'DEMO_LEADS_CSV_EXPORTED', metadata: expect.objectContaining({ count: 1 }) }));
  });
});
