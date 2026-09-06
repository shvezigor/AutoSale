import { describe, expect, it, vi } from 'vitest';

import { CatalogueAutoImporter } from './catalogue-auto-importer.js';

describe('CatalogueAutoImporter', () => {
  it('imports a version-2 normalized snapshot with original source coordinates', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      catalogueImportRun: { findFirst: vi.fn().mockResolvedValue({
        id: 'run-v2', tenantId: 'tenant-1', sourceId: 'source-v2', status: 'PREVIEW_READY',
        snapshotObjectKey: 'catalogue/normalized.json',
        mapping: {
          columns: [{ source: 'Назва', target: 'name', confidence: 0.99 }],
          transformSettings: { structurePlan: { version: 2, sourceRowNumbers: [24] } },
        },
        source: { type: 'CSV_UPLOAD', objectKey: 'catalogue/raw.csv', syncVersion: 0 },
      }), updateMany },
      catalogueSource: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const storage = { get: vi.fn().mockResolvedValue({
      body: Buffer.from(JSON.stringify({ headers: ['Назва'], rows: [['Двері']], sourceRowNumbers: [24] })),
      contentType: 'application/vnd.autosale.catalogue-table+json',
    }) };
    const importTable = vi.fn().mockResolvedValue({ totalRows: 1, validRows: 1, createdRows: 1, updatedRows: 0, skippedRows: 0, failedRows: 0, rowErrors: [] });

    await new CatalogueAutoImporter(prisma as never, storage as never, importTable).process({ tenantId: 'tenant-1', runId: 'run-v2' });

    expect(storage.get).toHaveBeenCalledWith('catalogue/normalized.json');
    expect(importTable).toHaveBeenCalledWith(prisma, expect.objectContaining({ sourceRowNumbers: [24], rows: [['Двері']] }));
  });

  it('claims and completes a confident CSV import without a preview round trip', async () => {
    const updateMany = vi.fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    const prisma = {
      catalogueImportRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'run-1', tenantId: 'tenant-1', sourceId: 'source-1', status: 'PREVIEW_READY',
          mapping: { columns: [{ source: 'назва', target: 'name', confidence: 0.99 }], transformSettings: null },
          source: { type: 'CSV_UPLOAD', objectKey: 'catalogue/products.csv', syncVersion: 0 },
        }),
        updateMany,
      },
      catalogueSource: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const storage = { get: vi.fn().mockResolvedValue({ body: Buffer.from('Назва,Ціна\nСукня,1200\n'), contentType: 'text/csv' }) };
    const importTable = vi.fn().mockResolvedValue({ totalRows: 1, validRows: 1, createdRows: 1, updatedRows: 0, skippedRows: 0, failedRows: 0, rowErrors: [] });

    await expect(new CatalogueAutoImporter(prisma as never, storage as never, importTable).process({ tenantId: 'tenant-1', runId: 'run-1' }))
      .resolves.toEqual({ status: 'COMPLETED' });

    expect(importTable).toHaveBeenCalledWith(prisma, expect.objectContaining({
      tenantId: 'tenant-1', sourceId: 'source-1', headers: ['назва', 'ціна'], rows: [['Сукня', '1200']],
      mapping: [{ source: 'назва', target: 'name' }], ownershipPolicy: 'REASSIGN',
    }));
    expect(updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { id: 'run-1', tenantId: 'tenant-1', status: 'PREVIEW_READY' }, data: expect.objectContaining({ status: 'PROCESSING' }) }));
    expect(updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED', createdRows: 1 }) }));
  });

  it('fences a Google import with the source sync version and lease', async () => {
    const runUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const sourceUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      catalogueImportRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'run-g', tenantId: 'tenant-1', sourceId: 'source-g', status: 'PREVIEW_READY', snapshotObjectKey: 'catalogue/google.json', sourceSyncVersion: 4,
          mapping: { columns: [{ source: 'name', target: 'name', confidence: 0.99 }], transformSettings: null },
          source: { type: 'GOOGLE_SHEETS', objectKey: null, syncVersion: 4 },
        }),
        updateMany: runUpdate,
      },
      catalogueSource: { updateMany: sourceUpdate },
    };
    const storage = { get: vi.fn().mockResolvedValue({ body: Buffer.from(JSON.stringify({ headers: ['Name'], rows: [['Сукня']] })), contentType: 'application/vnd.autosale.catalogue-table+json' }) };
    const importTable = vi.fn().mockResolvedValue({ totalRows: 1, validRows: 1, createdRows: 1, updatedRows: 0, skippedRows: 0, failedRows: 0, rowErrors: [] });

    await new CatalogueAutoImporter(prisma as never, storage as never, importTable).process({ tenantId: 'tenant-1', runId: 'run-g' });

    expect(sourceUpdate).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: expect.objectContaining({ syncVersion: 4 }), data: expect.objectContaining({ syncVersion: { increment: 1 }, syncLeaseId: expect.any(String) }) }));
    expect(runUpdate).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: expect.objectContaining({ sourceSyncVersion: 4 }), data: expect.objectContaining({ sourceSyncVersion: 5, status: 'PROCESSING' }) }));
    expect(importTable).toHaveBeenCalledWith(prisma, expect.objectContaining({ ownershipPolicy: 'FENCE_CROSS_SOURCE', lease: expect.objectContaining({ syncVersion: 5 }) }));
  });
});
