import { describe, expect, it, vi } from 'vitest';

import { DemoLeadEmailError } from './demo-lead-email.js';
import { DemoLeadNotificationProcessor } from './demo-lead-notification.processor.js';

const claim = { id: '00000000-0000-4000-8000-000000000001', leaseId: 'lease-1', attempt: 1 };

describe('DemoLeadNotificationProcessor', () => {
  it('leaves a due lead unclaimed while SMTP settings are incomplete', async () => {
    const store = { claim: vi.fn(), markSent: vi.fn(), markFailed: vi.fn() };
    const sender = { configured: false, send: vi.fn() };
    const queue = { add: vi.fn() };
    const processor = new DemoLeadNotificationProcessor(store as never, sender, queue as never);

    expect(await processor.process({ leadId: claim.id })).toBe('DEFERRED');
    expect(store.claim).not.toHaveBeenCalled();
    expect(sender.send).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('sends a claimed lead exactly once and ignores a completed replay', async () => {
    const store = { claim: vi.fn().mockResolvedValueOnce(claim).mockResolvedValueOnce(null), markSent: vi.fn().mockResolvedValue(true) };
    const sender = { send: vi.fn().mockResolvedValue(undefined) };
    const queue = { add: vi.fn() };
    const processor = new DemoLeadNotificationProcessor(store as never, sender, queue as never);
    expect(await processor.process({ leadId: claim.id })).toBe('SENT');
    expect(await processor.process({ leadId: claim.id })).toBe('SKIPPED');
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(store.markSent).toHaveBeenCalledWith(claim.id, claim.leaseId);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it.each([60_000, 300_000, 900_000])('schedules a retry with an ID-only payload after %i ms', async (delay) => {
    const now = new Date('2026-10-15T12:00:00.000Z');
    const store = { claim: vi.fn().mockResolvedValue(claim), markFailed: vi.fn().mockResolvedValue(new Date(now.getTime() + delay)) };
    const sender = { send: vi.fn().mockRejectedValue(new DemoLeadEmailError('DELIVERY_FAILED', false)) };
    const queue = { add: vi.fn().mockResolvedValue(undefined) };
    const processor = new DemoLeadNotificationProcessor(store as never, sender, queue as never, () => now);
    expect(await processor.process({ leadId: claim.id })).toBe('RETRY_SCHEDULED');
    expect(store.markFailed).toHaveBeenCalledWith(claim.id, claim.leaseId, 'DELIVERY_FAILED', false);
    expect(queue.add).toHaveBeenCalledWith('demo-lead.notify', { leadId: claim.id }, expect.objectContaining({ delay }));
  });

  it('leaves a terminal failure without another job', async () => {
    const store = { claim: vi.fn().mockResolvedValue({ ...claim, attempt: 4 }), markFailed: vi.fn().mockResolvedValue(null) };
    const sender = { send: vi.fn().mockRejectedValue(new DemoLeadEmailError('RECIPIENT_REJECTED', true)) };
    const queue = { add: vi.fn() };
    const processor = new DemoLeadNotificationProcessor(store as never, sender, queue as never);
    expect(await processor.process({ leadId: claim.id })).toBe('TERMINAL');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('does not misclassify a database completion failure as an SMTP rejection', async () => {
    const store = { claim: vi.fn().mockResolvedValue(claim), markSent: vi.fn().mockRejectedValue(new Error('database unavailable')), markFailed: vi.fn() };
    const processor = new DemoLeadNotificationProcessor(store as never, { send: vi.fn().mockResolvedValue(undefined) }, { add: vi.fn() } as never);
    await expect(processor.process({ leadId: claim.id })).rejects.toThrow('database unavailable');
    expect(store.markFailed).not.toHaveBeenCalled();
  });
});
