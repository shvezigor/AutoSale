import { describe, expect, it, vi } from 'vitest';

import { AdminDemoLeadsService } from './admin-demo-leads.service.js';

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
});
