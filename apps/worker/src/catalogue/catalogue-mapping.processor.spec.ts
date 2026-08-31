import { describe, expect, it, vi } from 'vitest';

import { CatalogueMappingProcessor } from './catalogue-mapping.processor.js';

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
    expect(updateMany).toHaveBeenLastCalledWith({ where: { id: runId, tenantId, status: 'MAPPING' }, data: { mappingId: 'mapping-1', status: 'MAPPING_REVIEW' } });
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

    expect(updateMany).toHaveBeenLastCalledWith({ where: { id: runId, tenantId, status: { in: ['UPLOADED', 'MAPPING'] } }, data: { mappingId: null, status: 'MAPPING_REVIEW', rowErrors: [{ errors: ['MAPPING_UNAVAILABLE'] }] } });
  });

  it('does not report a draft when it loses the run assignment race', async () => {
    const updateMany = vi.fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    const prisma = {
      catalogueImportRun: { updateMany, findFirst: vi.fn().mockResolvedValue({ id: runId, tenantId, sourceId: 'source-1', source: { objectKey: 'catalogue/object.csv', type: 'CSV_UPLOAD', headerFingerprint: 'fingerprint-1' } }) },
      catalogueMapping: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'mapping-race' }) },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(prisma),
    };
    const mapper = { suggest: vi.fn().mockResolvedValue({ proposal: { columns: [{ source: 'артикул', target: 'sku', confidence: 0.9 }, { source: 'назва', target: 'name', confidence: 0.9 }] }, metadata: { responseId: 'resp', model: 'model', promptVersion: 'v1', schemaVersion: 'schema', latencyMs: 1, inputTokens: 1, outputTokens: 1 } }) };
    const storage = { get: vi.fn().mockResolvedValue({ body: Buffer.from('Артикул,Назва\nSKU-1,Куртка\n'), contentType: 'text/csv' }) };

    await expect(new CatalogueMappingProcessor(prisma as never, storage as never, mapper).process({ tenantId, runId })).resolves.toEqual({ status: 'MAPPING_REVIEW', proposal: null });
    expect(updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ mappingId: null, status: 'MAPPING_REVIEW' }) }));
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
      where: expect.objectContaining({ id: runId, tenantId, OR: expect.arrayContaining([expect.objectContaining({ status: 'UPLOADED' }), expect.objectContaining({ status: 'MAPPING', updatedAt: { lt: expect.any(Date) } })]) }),
    }));
  });

  it('does not double-process a fresh mapping lease', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const mapper = { suggest: vi.fn() };
    const prisma = { catalogueImportRun: { updateMany, findFirst: vi.fn() } };

    await expect(new CatalogueMappingProcessor(prisma as never, {} as never, mapper).process({ tenantId, runId })).resolves.toEqual({ status: 'SKIPPED', proposal: null });
    expect(mapper.suggest).not.toHaveBeenCalled();
  });
});
