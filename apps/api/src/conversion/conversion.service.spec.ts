import { describe, expect, it, vi } from 'vitest';

import { ConversionService } from './conversion.service.js';

describe('ConversionService anonymous counters', () => {
  const event = { event: 'pricing_view' as const, locale: 'uk' as const };

  it('does not read Redis or persist anything while collection is disabled', async () => {
    const prisma = { $queryRaw: vi.fn() };
    const redis = { eval: vi.fn() };
    await new ConversionService(prisma as never, redis, 'p'.repeat(32), false).recordAnonymous(event, '192.0.2.10');
    expect(redis.eval).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('uses an HMAC key, a bounded Redis quota and the SQL counter function when enabled', async () => {
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([{ api_increment_marketing_counter: null }]) };
    const redis = { eval: vi.fn().mockResolvedValue([1, 0]) };
    await new ConversionService(prisma as never, redis, 'p'.repeat(32), true).recordAnonymous(event, '192.0.2.10');
    expect(redis.eval).toHaveBeenCalledOnce();
    expect(JSON.stringify(redis.eval.mock.calls)).not.toContain('192.0.2.10');
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
  });

  it('fails closed on quota exhaustion or Redis outage', async () => {
    const prisma = { $queryRaw: vi.fn() };
    const redis = { eval: vi.fn().mockResolvedValue([0, 12]) };
    const service = new ConversionService(prisma as never, redis, 'p'.repeat(32), true);
    await expect(service.recordAnonymous(event, '192.0.2.10')).rejects.toMatchObject({ status: 429 });
    redis.eval.mockRejectedValueOnce(new Error('fictional outage'));
    await expect(service.recordAnonymous(event, '192.0.2.10')).rejects.toMatchObject({ status: 503 });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('ConversionService authenticated plan interest', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  it('does not persist interest when measurement is disabled', async () => {
    const prisma = { $transaction: vi.fn() };
    expect(await new ConversionService(prisma as never, {} as never, 'p'.repeat(32), false)
      .recordPlanInterest(tenantId, 'growth')).toEqual({ recorded: false });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('deduplicates one tenant/plan/UTC day and uses a tenant-scoped transaction', async () => {
    const createMany = vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const query = vi.fn().mockResolvedValue([]);
    const tx = { $queryRaw: query, tenantPlanInterest: { createMany } };
    const prisma = { $transaction: (operation: (client: typeof tx) => Promise<unknown>) => operation(tx) };
    const service = new ConversionService(prisma as never, {} as never, 'p'.repeat(32), true);
    const now = new Date('2026-10-20T23:59:59Z');
    expect(await service.recordPlanInterest(tenantId, 'growth', now)).toEqual({ recorded: true });
    expect(await service.recordPlanInterest(tenantId, 'growth', now)).toEqual({ recorded: false });
    expect(query).toHaveBeenCalledTimes(2);
    expect(createMany).toHaveBeenCalledWith({ data: [{ tenantId, planId: 'growth', day: new Date('2026-10-20T00:00:00Z'), createdAt: now }], skipDuplicates: true });
  });
});
