import { describe, expect, it, vi } from 'vitest';

vi.mock('@autosale/database', async (importOriginal) => ({
  ...await importOriginal<typeof import('@autosale/database')>(),
  withTenantTransaction: async <T>(prisma: unknown, _tenantId: string, operation: (transaction: unknown) => Promise<T>) => operation(prisma),
}));

import { RetentionDryRunProcessor } from './retention-dry-run.processor.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-10-02T12:00:00.000Z');

describe('RetentionDryRunProcessor', () => {
  it('persists count-only summaries without mutating candidates or leaking content', async () => {
    const updateMany = vi.fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    const prisma = {
      tenantRetentionDryRun: { updateMany },
      webhookEvent: {
        count: vi.fn().mockResolvedValue(4),
        aggregate: vi.fn().mockResolvedValue({ _min: { receivedAt: new Date('2026-07-01T00:00:00Z') } }),
      },
      userNotification: {
        count: vi.fn().mockResolvedValue(2),
        aggregate: vi.fn().mockResolvedValue({ _min: { createdAt: new Date('2026-01-01T00:00:00Z') } }),
      },
      securityAuditLog: {
        count: vi.fn().mockResolvedValue(1),
        aggregate: vi.fn().mockResolvedValue({ _min: { createdAt: new Date('2025-01-01T00:00:00Z') } }),
      },
      $executeRaw: vi.fn(),
    };

    const result = await new RetentionDryRunProcessor(prisma as never, () => now).process({ tenantId, runId });

    expect(result).toMatchObject({
      status: 'COMPLETED',
      summary: expect.arrayContaining([
        expect.objectContaining({ category: 'RAW_WEBHOOKS', candidateCount: 4 }),
        expect.objectContaining({ category: 'ORDERS_PAYMENTS_AND_DELIVERY', policyStatus: 'POLICY_NOT_CONFIGURED', candidateCount: null }),
      ]),
    });
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('Fictional customer message');
    expect(updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'COMPLETED', summary: expect.any(Array) }),
    }));
  });

  it('records a safe retryable failure without exposing the database error', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      tenantRetentionDryRun: { updateMany },
      webhookEvent: { count: vi.fn().mockRejectedValue(new Error('Fictional customer message')), aggregate: vi.fn() },
    };

    await expect(new RetentionDryRunProcessor(prisma as never, () => now).process({ tenantId, runId }))
      .resolves.toEqual({ status: 'FAILED', summary: null });
    expect(JSON.stringify(updateMany.mock.calls)).not.toContain('Fictional customer message');
    expect(updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED', lastErrorCode: 'RETENTION_DRY_RUN_FAILED' }),
    }));
  });
});
