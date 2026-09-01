import { describe, expect, it, vi } from 'vitest';

import { CatalogueMappingProcessor } from './catalogue-mapping.processor.js';
import { CatalogueMappingReconciler } from './catalogue-mapping-reconciler.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222222';

describe('CatalogueMappingProcessor', () => {
  it('persists a reviewed AI draft and moves the tenant run to mapping review', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'mapping-1' });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      catalogueImportRun: {
        updateMany,
        findFirst: vi.fn().mockResolvedValue({ id: runId, tenantId, sourceId: 'source-1', source: { objectKey: 'catalogue/object.csv', type: 'CSV_UPLOAD', headerFingerprint: 'fingerprint-1' } }),
      },
      catalogueMapping: { findFirst: vi.fn().mockResolvedValue({ version: 3 }), create },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(prisma),
    };
    const mapper = { suggest: vi.fn().mockResolvedValue({
      proposal: { columns: [{ source: 'артикул', target: 'sku', confidence: 0.99 }, { source: 'назва', target: 'name', confidence: 0.98 }] },
      metadata: { responseId: 'resp-1', model: 'gpt-5.4-mini', promptVersion: 'catalogue-column-mapping-v1', schemaVersion: 'catalogue-mapping-proposal-v1', latencyMs: 80, inputTokens: 50, outputTokens: 20 },
    }) };
    const storage = { get: vi.fn().mockResolvedValue({ body: Buffer.from('Артикул,Назва\nSKU-1,Куртка\n'), contentType: 'text/csv' }) };

    await new CatalogueMappingProcessor(prisma as never, storage as never, mapper).process({ tenantId, runId });

    expect(updateMany.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      where: expect.objectContaining({ OR: expect.arrayContaining([expect.objectContaining({ status: 'UPLOADED' }), expect.objectContaining({ status: 'MAPPING', mappingLeaseId: { not: null }, mappingLeaseExpiresAt: { lt: expect.any(Date) } })]) }),
      data: expect.objectContaining({ status: 'MAPPING', mappingLeaseId: expect.any(String), mappingLeaseExpiresAt: expect.any(Date) }),
    }));
    expect(mapper.suggest).toHaveBeenCalledWith({
      headers: ['артикул', 'назва'],
      primitiveTypes: { артикул: 'string', назва: 'string' },
      sampleRows: [{ артикул: 'SKU-1', назва: 'Куртка' }],
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      tenantId, sourceId: 'source-1', version: 4, ownerModified: false, confirmedAt: null,
      columns: [{ source: 'артикул', target: 'sku', confidence: 0.99 }, { source: 'назва', target: 'name', confidence: 0.98 }],
      aiModel: 'gpt-5.4-mini', promptVersion: 'catalogue-column-mapping-v1', schemaVersion: 'catalogue-mapping-proposal-v1', aiLatencyMs: 80, aiInputTokens: 50, aiOutputTokens: 20,
    }) }));
    expect(updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: runId, tenantId, status: 'MAPPING', mappingLeaseId: expect.any(String) }),
      data: expect.objectContaining({ mappingId: 'mapping-1', status: 'MAPPING_REVIEW', mappingLeaseId: null, mappingLeaseExpiresAt: null }),
    }));
  });

  it('leaves a manual mapping path when the provider fails', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      catalogueImportRun: {
        updateMany,
        findFirst: vi.fn().mockResolvedValue({ id: runId, tenantId, sourceId: 'source-1', source: { objectKey: 'catalogue/object.csv', type: 'CSV_UPLOAD', headerFingerprint: 'fingerprint-1' } }),
      },
      catalogueMapping: { findFirst: vi.fn() },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(prisma),
    };
    const mapper = { suggest: vi.fn().mockRejectedValue(new Error('provider unavailable')) };
    const storage = { get: vi.fn().mockResolvedValue({ body: Buffer.from('Артикул,Назва\nSKU-1,Куртка\n'), contentType: 'text/csv' }) };

    await expect(new CatalogueMappingProcessor(prisma as never, storage as never, mapper).process({ tenantId, runId })).resolves.toEqual({ status: 'MAPPING_REVIEW', proposal: null });

    expect(updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: runId, tenantId, status: 'MAPPING', mappingLeaseId: expect.any(String), mappingLeaseExpiresAt: { gt: expect.any(Date) } }),
      data: expect.objectContaining({ mappingId: null, status: 'MAPPING_REVIEW', mappingLeaseId: null, mappingLeaseExpiresAt: null, rowErrors: [{ errors: ['MAPPING_UNAVAILABLE'] }] }),
    }));
  });

  it('does not let an old lease owner persist a draft after a reclaim', async () => {
    const updateMany = vi.fn().mockImplementation((args: { data: { mappingId?: string | null } }) => {
      if (args.data.mappingId === 'mapping-race') return Promise.resolve({ count: 0 });
      if (args.data.mappingId === null) return Promise.resolve({ count: 0 });
      return Promise.resolve({ count: 1 });
    });
    const prisma = {
      catalogueImportRun: { updateMany, findFirst: vi.fn().mockResolvedValue({ id: runId, tenantId, sourceId: 'source-1', source: { objectKey: 'catalogue/object.csv', type: 'CSV_UPLOAD', headerFingerprint: 'fingerprint-1' } }) },
      catalogueMapping: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'mapping-race' }) },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(prisma),
    };
    const mapper = { suggest: vi.fn().mockResolvedValue({ proposal: { columns: [{ source: 'артикул', target: 'sku', confidence: 0.9 }, { source: 'назва', target: 'name', confidence: 0.9 }] }, metadata: { responseId: 'resp', model: 'model', promptVersion: 'v1', schemaVersion: 'schema', latencyMs: 1, inputTokens: 1, outputTokens: 1 } }) };
    const storage = { get: vi.fn().mockResolvedValue({ body: Buffer.from('Артикул,Назва\nSKU-1,Куртка\n'), contentType: 'text/csv' }) };

    await expect(new CatalogueMappingProcessor(prisma as never, storage as never, mapper).process({ tenantId, runId })).resolves.toEqual({ status: 'SKIPPED', proposal: null });
    expect(updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ mappingLeaseId: expect.any(String), mappingLeaseExpiresAt: { gt: expect.any(Date) } }),
      data: expect.objectContaining({ mappingId: null, status: 'MAPPING_REVIEW' }),
    }));
  });

  it('reclaims a stale mapping lease after a worker crash', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      catalogueImportRun: { updateMany, findFirst: vi.fn().mockResolvedValue({ id: runId, tenantId, sourceId: 'source-1', source: { objectKey: 'catalogue/object.csv', type: 'CSV_UPLOAD', headerFingerprint: 'fingerprint-1' } }) },
      catalogueMapping: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'mapping-reclaimed' }) },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(prisma),
    };
    const mapper = { suggest: vi.fn().mockResolvedValue({ proposal: { columns: [{ source: 'артикул', target: 'sku', confidence: 0.9 }, { source: 'назва', target: 'name', confidence: 0.9 }] }, metadata: { responseId: 'resp', model: 'model', promptVersion: 'v1', schemaVersion: 'schema', latencyMs: 1, inputTokens: 1, outputTokens: 1 } }) };
    const storage = { get: vi.fn().mockResolvedValue({ body: Buffer.from('Артикул,Назва\nSKU-1,Куртка\n'), contentType: 'text/csv' }) };

    await expect(new CatalogueMappingProcessor(prisma as never, storage as never, mapper).process({ tenantId, runId })).resolves.toMatchObject({ proposal: expect.any(Object) });
    expect(updateMany.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      where: expect.objectContaining({ id: runId, tenantId, OR: expect.arrayContaining([expect.objectContaining({ status: 'UPLOADED' }), expect.objectContaining({ status: 'MAPPING', mappingLeaseId: { not: null }, mappingLeaseExpiresAt: { lt: expect.any(Date) } })]) }),
    }));
  });

  it('does not double-process a fresh mapping lease', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const mapper = { suggest: vi.fn() };
    const prisma = { catalogueImportRun: { updateMany, findFirst: vi.fn() } };

    await expect(new CatalogueMappingProcessor(prisma as never, {} as never, mapper).process({ tenantId, runId })).resolves.toEqual({ status: 'SKIPPED', proposal: null });
    expect(mapper.suggest).not.toHaveBeenCalled();
  });

  it('heartbeats a long-running mapping and clears the heartbeat when complete', async () => {
    vi.useFakeTimers();
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    let resolveSuggestion!: (value: { proposal: { columns: Array<{ source: string; target: 'sku'; confidence: number }> }; metadata: { responseId: string; model: string; promptVersion: string; schemaVersion: string; latencyMs: number; inputTokens: number; outputTokens: number } }) => void;
    const mapper = { suggest: vi.fn().mockImplementation(() => new Promise((resolve) => { resolveSuggestion = resolve; })) };
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      catalogueImportRun: { updateMany, findFirst: vi.fn().mockResolvedValue({ id: runId, tenantId, sourceId: 'source-1', source: { objectKey: 'catalogue/object.csv', type: 'CSV_UPLOAD', headerFingerprint: 'fingerprint-1' } }) },
      catalogueMapping: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'mapping-heartbeat' }) },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(prisma),
    };
    const storage = { get: vi.fn().mockResolvedValue({ body: Buffer.from('Артикул\nSKU-1\n'), contentType: 'text/csv' }) };

    const processing = new CatalogueMappingProcessor(prisma as never, storage as never, mapper).process({ tenantId, runId });
    await vi.waitFor(() => expect(mapper.suggest).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(2 * 60 * 1_000);
    expect(updateMany.mock.calls.filter(([args]) => args.where.mappingLeaseId && args.data.mappingLeaseExpiresAt)).toHaveLength(3);

    resolveSuggestion({ proposal: { columns: [{ source: 'артикул', target: 'sku', confidence: 0.9 }] }, metadata: { responseId: 'resp', model: 'model', promptVersion: 'v1', schemaVersion: 'schema', latencyMs: 1, inputTokens: 1, outputTokens: 1 } });
    await expect(processing).resolves.toMatchObject({ status: 'MAPPING_REVIEW' });
    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
    vi.useRealTimers();
  });

  it('clears the heartbeat after provider failure', async () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      catalogueImportRun: { updateMany, findFirst: vi.fn().mockResolvedValue({ id: runId, tenantId, sourceId: 'source-1', source: { objectKey: 'catalogue/object.csv', type: 'CSV_UPLOAD', headerFingerprint: 'fingerprint-1' } }) },
      catalogueMapping: { findFirst: vi.fn() },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(prisma),
    };
    const mapper = { suggest: vi.fn().mockRejectedValue(new Error('provider unavailable')) };
    const storage = { get: vi.fn().mockResolvedValue({ body: Buffer.from('Артикул\nSKU-1\n'), contentType: 'text/csv' }) };

    await expect(new CatalogueMappingProcessor(prisma as never, storage as never, mapper).process({ tenantId, runId }))
      .resolves.toEqual({ status: 'MAPPING_REVIEW', proposal: null });
    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });

  it('keeps a mapper active beyond its lease duration so reconcilers and another claimant cannot reclaim it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));
    const run = { status: 'UPLOADED', leaseId: null as string | null, expiresAt: null as Date | null };
    const updateMany = vi.fn().mockImplementation(async (args: { where: { OR?: Array<{ status: string; mappingLeaseExpiresAt?: { lt: Date } }>; status?: string; mappingLeaseId?: string; mappingLeaseExpiresAt?: { gt: Date } }; data: { status?: string; mappingLeaseId?: string | null; mappingLeaseExpiresAt?: Date | null; mappingId?: string | null } }) => {
      if (args.where.OR) {
        const now = new Date();
        const claimable = run.status === 'UPLOADED' || (run.status === 'MAPPING' && run.expiresAt !== null && run.expiresAt < now);
        if (!claimable) return { count: 0 };
        run.status = 'MAPPING';
        run.leaseId = args.data.mappingLeaseId ?? null;
        run.expiresAt = args.data.mappingLeaseExpiresAt ?? null;
        return { count: 1 };
      }
      const owned = run.status === 'MAPPING'
        && run.leaseId === args.where.mappingLeaseId
        && run.expiresAt !== null
        && run.expiresAt > (args.where.mappingLeaseExpiresAt?.gt ?? new Date(0));
      if (!owned) return { count: 0 };
      if (args.data.status) run.status = args.data.status;
      run.leaseId = args.data.mappingLeaseId ?? run.leaseId;
      run.expiresAt = args.data.mappingLeaseExpiresAt ?? run.expiresAt;
      return { count: 1 };
    });
    const source = { objectKey: 'catalogue/object.csv', type: 'CSV_UPLOAD' as const, headerFingerprint: 'fingerprint-1' };
    const prisma = {
      catalogueImportRun: {
        updateMany,
        findFirst: vi.fn().mockImplementation(async (args: { where: { status: string; mappingLeaseId: string } }) => run.status === args.where.status && run.leaseId === args.where.mappingLeaseId ? { id: runId, tenantId, sourceId: 'source-1', source } : null),
        findMany: vi.fn().mockImplementation(async () => run.status === 'UPLOADED' || (run.status === 'MAPPING' && run.expiresAt !== null && run.expiresAt < new Date()) ? [{ id: runId, tenantId }] : []),
      },
      catalogueMapping: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'mapping-heartbeat-long' }) },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(prisma),
    };
    let resolveSuggestion!: (value: { proposal: { columns: Array<{ source: string; target: 'sku'; confidence: number }> }; metadata: { responseId: string; model: string; promptVersion: string; schemaVersion: string; latencyMs: number; inputTokens: number; outputTokens: number } }) => void;
    const mapper = { suggest: vi.fn().mockImplementation(() => new Promise((resolve) => { resolveSuggestion = resolve; })) };
    const storage = { get: vi.fn().mockResolvedValue({ body: Buffer.from('Артикул\nSKU-1\n'), contentType: 'text/csv' }) };
    const processor = new CatalogueMappingProcessor(prisma as never, storage as never, mapper);
    const processing = processor.process({ tenantId, runId });
    await vi.waitFor(() => expect(mapper.suggest).toHaveBeenCalledOnce());

    await vi.advanceTimersByTimeAsync(6 * 60 * 1_000);
    const queue = { add: vi.fn() };
    await expect(new CatalogueMappingReconciler(prisma as never, queue).reconcile()).resolves.toEqual({ attempted: 0, enqueued: 0 });
    await expect(new CatalogueMappingProcessor(prisma as never, storage as never, mapper).process({ tenantId, runId }))
      .resolves.toEqual({ status: 'SKIPPED', proposal: null });
    expect(mapper.suggest).toHaveBeenCalledOnce();

    resolveSuggestion({ proposal: { columns: [{ source: 'артикул', target: 'sku', confidence: 0.9 }] }, metadata: { responseId: 'resp', model: 'model', promptVersion: 'v1', schemaVersion: 'schema', latencyMs: 1, inputTokens: 1, outputTokens: 1 } });
    await expect(processing).resolves.toMatchObject({ status: 'MAPPING_REVIEW' });
    vi.useRealTimers();
  });
});
