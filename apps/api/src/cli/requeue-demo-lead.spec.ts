import { describe, expect, it, vi } from 'vitest';

import { requeueDemoLead } from './requeue-demo-lead.js';

const id = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';

describe('requeueDemoLead', () => {
  it('requires the exact UUID twice before touching the database', async () => {
    const prisma = { demoLead: { updateMany: vi.fn() } };
    await expect(requeueDemoLead(prisma as never, id, otherId)).rejects.toThrow('CONFIRMATION_MISMATCH');
    await expect(requeueDemoLead(prisma as never, 'not-a-uuid', 'not-a-uuid')).rejects.toThrow('INVALID_LEAD_ID');
    expect(prisma.demoLead.updateMany).not.toHaveBeenCalled();
  });

  it('requeues one terminal failure with a conditional update and no contact data', async () => {
    const prisma = { demoLead: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
    const now = new Date('2026-10-15T12:00:00.000Z');
    await expect(requeueDemoLead(prisma as never, id, id, () => now)).resolves.toEqual({ id, requeued: true });
    expect(prisma.demoLead.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id, notificationStatus: 'FAILED', notificationNextAttemptAt: null }),
      data: expect.objectContaining({ notificationStatus: 'PENDING', notificationAttempts: 0, notificationNextAttemptAt: now }),
    });
    expect(JSON.stringify(prisma.demoLead.updateMany.mock.calls)).not.toMatch(/name|email|phone|note/i);
  });

  it('refuses a SENT or active record that the conditional update cannot change', async () => {
    const prisma = { demoLead: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } };
    await expect(requeueDemoLead(prisma as never, id, id)).rejects.toThrow('LEAD_NOT_REQUEUEABLE');
  });
});
