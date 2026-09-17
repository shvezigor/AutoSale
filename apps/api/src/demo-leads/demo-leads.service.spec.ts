import { describe, expect, it, vi } from 'vitest';

import { DemoLeadsService } from './demo-leads.service.js';

const input = { name: 'Olena', company: 'Store', email: 'owner@example.com', phone: '', orderVolume: '50_TO_300', note: '', locale: 'en', privacyConsent: true } as const;

describe('DemoLeadsService', () => {
  it('persists the lead before notifying and marks delivery sent', async () => {
    const events: string[] = [];
    const lead = { id: 'lead-1', idempotencyKey: 'key', name: input.name, company: input.company, email: input.email, phone: null, orderVolume: input.orderVolume, note: null, locale: input.locale, notificationStatus: 'PENDING' };
    const prisma = { demoLead: { create: vi.fn(async () => { events.push('persist'); return lead; }), update: vi.fn(async () => { events.push('status'); return lead; }) } };
    const notifier = { send: vi.fn(async () => { events.push('notify'); }) };
    const service = new DemoLeadsService(prisma as never, notifier);
    await expect(service.create(input, 'key')).resolves.toEqual({ id: 'lead-1', accepted: true });
    expect(events).toEqual(['persist', 'notify', 'status']);
    expect(prisma.demoLead.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ notificationStatus: 'SENT' }) }));
  });
  it('keeps an accepted durable lead when notification fails', async () => {
    const lead = { id: 'lead-2', idempotencyKey: 'key', name: input.name, company: input.company, email: input.email, phone: null, orderVolume: input.orderVolume, note: null, locale: input.locale, notificationStatus: 'PENDING' };
    const prisma = { demoLead: { create: vi.fn().mockResolvedValue(lead), update: vi.fn().mockResolvedValue(lead) } };
    const service = new DemoLeadsService(prisma as never, { send: vi.fn().mockRejectedValue(new Error('smtp')) });
    await expect(service.create(input, 'key')).resolves.toEqual({ id: 'lead-2', accepted: true });
    expect(prisma.demoLead.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ notificationStatus: 'FAILED', lastNotificationError: 'DELIVERY_FAILED' }) }));
  });
});
