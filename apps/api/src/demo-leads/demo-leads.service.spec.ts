import { Prisma } from '@autosale/database';
import { describe, expect, it, vi } from 'vitest';

import { DemoLeadsService } from './demo-leads.service.js';

const input = { name: 'Fictional Olena', company: 'Example Store', email: 'lead@example.test', phone: '', orderVolume: '50_TO_300', note: '', locale: 'en', privacyConsent: true } as const;
const lead = { id: '00000000-0000-4000-8000-000000000001', idempotencyKey: 'fictional-key', notificationStatus: 'PENDING' };

describe('DemoLeadsService', () => {
  it('persists before adding an ID-only job and leaves delivery to the worker', async () => {
    const events: string[] = [];
    const prisma = { demoLead: { create: vi.fn(async () => { events.push('persist'); return lead; }), update: vi.fn() } };
    const queue = { add: vi.fn(async (_name: string, _data: { leadId: string }) => { events.push('enqueue'); }) };
    const service = new DemoLeadsService(prisma as never, queue as never);

    await expect(service.create(input, 'fictional-key')).resolves.toEqual({ id: lead.id, accepted: true });
    expect(events).toEqual(['persist', 'enqueue']);
    expect(prisma.demoLead.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      notificationNextAttemptAt: expect.any(Date), name: input.name, email: input.email,
    }) });
    expect(queue.add).toHaveBeenCalledWith('demo-lead.notify', { leadId: lead.id }, expect.objectContaining({ attempts: 1 }));
    expect(JSON.stringify(queue.add.mock.calls[0]![1])).toBe(JSON.stringify({ leadId: lead.id }));
    expect(prisma.demoLead.update).not.toHaveBeenCalled();
  });

  it('accepts the saved lead when Redis is unavailable', async () => {
    const prisma = { demoLead: { create: vi.fn().mockResolvedValue(lead), update: vi.fn() } };
    const queue = { add: vi.fn().mockRejectedValue(new Error('Redis unavailable')) };
    const service = new DemoLeadsService(prisma as never, queue as never);

    await expect(service.create(input, 'fictional-key')).resolves.toEqual({ id: lead.id, accepted: true });
    expect(prisma.demoLead.update).not.toHaveBeenCalled();
  });

  it('returns an existing idempotent lead without another queue job', async () => {
    const prisma = { demoLead: {
      create: vi.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7.10.0' })),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ ...lead, notificationStatus: 'SENT' }),
    } };
    const queue = { add: vi.fn() };
    const service = new DemoLeadsService(prisma as never, queue as never);

    await expect(service.create(input, 'fictional-key')).resolves.toEqual({ id: lead.id, accepted: true });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('does not requeue a terminal failed lead on an idempotent replay', async () => {
    const prisma = { demoLead: {
      create: vi.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7.10.0' })),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ ...lead, notificationStatus: 'FAILED', notificationNextAttemptAt: null }),
    } };
    const queue = { add: vi.fn() };
    const service = new DemoLeadsService(prisma as never, queue as never);

    await expect(service.create(input, 'fictional-key')).resolves.toEqual({ id: lead.id, accepted: true });
    expect(queue.add).not.toHaveBeenCalled();
  });
});
