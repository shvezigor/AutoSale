import { describe, expect, it, vi } from 'vitest';
import { ReplyStyleService } from './reply-style.service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';

describe('ReplyStyleService', () => {
  it('returns disabled defaults without creating a row', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const prisma = { $transaction: (run: (tx: unknown) => unknown) => run({
      $queryRaw: vi.fn().mockResolvedValue([{ available: true }]), tenantReplyStyle: { findUnique },
    }) };
    const result = await new ReplyStyleService(prisma as never).get(tenantId);
    expect(result).toMatchObject({ enabled: false, companyName: '', tone: 'NEUTRAL' });
    expect(findUnique).toHaveBeenCalledWith({ where: { tenantId } });
  });

  it('returns an existing public reply style without Prisma storage metadata', async () => {
    const savedAt = new Date('2026-10-05T12:30:31.000Z');
    const existing = {
      id: '22222222-2222-4222-8222-222222222222', tenantId, enabled: true,
      companyName: 'Fictional Shop', tone: 'FRIENDLY', addressForm: 'FORMAL_YOU', guidance: '',
      createdAt: savedAt, updatedAt: savedAt,
    };
    const prisma = { $transaction: (run: (tx: unknown) => unknown) => run({
      $queryRaw: vi.fn().mockResolvedValue([{ available: true }]),
      tenantReplyStyle: { findUnique: vi.fn().mockResolvedValue(existing) },
    }) };

    await expect(new ReplyStyleService(prisma as never).get(tenantId)).resolves.toEqual({
      tenantId, enabled: true, companyName: 'Fictional Shop', tone: 'FRIENDLY',
      addressForm: 'FORMAL_YOU', guidance: '',
    });
  });

  it('requires a company name before enabling', async () => {
    const upsert = vi.fn();
    const prisma = { $transaction: (run: (tx: unknown) => unknown) => run({
      $queryRaw: vi.fn().mockResolvedValue([{ available: true }]), tenantReplyStyle: { findUnique: vi.fn().mockResolvedValue(null), upsert },
    }) };
    await expect(new ReplyStyleService(prisma as never).update(tenantId, { enabled: true }))
      .rejects.toMatchObject({ response: expect.objectContaining({ code: 'VALIDATION_FAILED' }) });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('persists only the selected tenant and merges partial updates', async () => {
    const current = { tenantId, enabled: false, companyName: 'Fictional Shop', tone: 'NEUTRAL', addressForm: 'FORMAL_YOU', guidance: '' };
    const upsert = vi.fn().mockResolvedValue({ ...current, enabled: true });
    const prisma = { $transaction: (run: (tx: unknown) => unknown) => run({
      $queryRaw: vi.fn().mockResolvedValue([{ available: true }]), tenantReplyStyle: { findUnique: vi.fn().mockResolvedValue(current), upsert },
    }) };
    const result = await new ReplyStyleService(prisma as never).update(tenantId, { enabled: true });
    expect(result.enabled).toBe(true);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId }, update: expect.objectContaining({ enabled: true, companyName: 'Fictional Shop' }),
    }));
  });

  it('returns the public reply style after Prisma adds storage metadata', async () => {
    const savedAt = new Date('2026-10-05T12:30:31.000Z');
    const saved = {
      id: '22222222-2222-4222-8222-222222222222', tenantId, enabled: true,
      companyName: 'Fictional Shop', tone: 'FRIENDLY', addressForm: 'FORMAL_YOU', guidance: '',
      createdAt: savedAt, updatedAt: savedAt,
    };
    const prisma = { $transaction: (run: (tx: unknown) => unknown) => run({
      $queryRaw: vi.fn().mockResolvedValue([{ available: true }]),
      tenantReplyStyle: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue(saved) },
    }) };

    await expect(new ReplyStyleService(prisma as never).update(tenantId, {
      enabled: true, companyName: 'Fictional Shop', tone: 'FRIENDLY',
    })).resolves.toEqual({
      tenantId, enabled: true, companyName: 'Fictional Shop', tone: 'FRIENDLY',
      addressForm: 'FORMAL_YOU', guidance: '',
    });
  });
});
