import { describe, expect, it, vi } from 'vitest';

import { DemoLeadNotificationReconciler } from './demo-lead-notification.reconciler.js';

const first = '00000000-0000-4000-8000-000000000001';
const second = '00000000-0000-4000-8000-000000000002';

describe('DemoLeadNotificationReconciler', () => {
  it('queues due IDs only with a bounded scan after finalizing expired last attempts', async () => {
    const events: string[] = [];
    const store = {
      finalizeExpiredLeases: vi.fn(async () => { events.push('finalize'); return 1; }),
      listDue: vi.fn(async () => { events.push('list'); return [first, second]; }),
    };
    const queue = { add: vi.fn().mockResolvedValue(undefined) };
    const reconciler = new DemoLeadNotificationReconciler(store as never, queue as never, () => new Date('2026-10-15T12:00:00Z'));
    expect(await reconciler.reconcile()).toEqual({ attempted: 2, enqueued: 2, failed: 0 });
    expect(events).toEqual(['finalize', 'list']);
    expect(store.listDue).toHaveBeenCalledWith(50);
    expect(queue.add).toHaveBeenCalledWith('demo-lead.notify', { leadId: first }, expect.objectContaining({ attempts: 1 }));
    expect(JSON.stringify(queue.add.mock.calls)).not.toContain('lead@example.test');
  });

  it('leaves the database untouched when queue insertion fails', async () => {
    const store = { finalizeExpiredLeases: vi.fn().mockResolvedValue(0), listDue: vi.fn().mockResolvedValue([first]) };
    const queue = { add: vi.fn().mockRejectedValue(new Error('Redis unavailable')) };
    const reconciler = new DemoLeadNotificationReconciler(store as never, queue as never);
    expect(await reconciler.reconcile()).toEqual({ attempted: 1, enqueued: 0, failed: 1 });
  });
});
