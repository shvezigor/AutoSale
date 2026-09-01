import { GoogleSheetsReadError, googleSheetsStructureFingerprint } from '@autosale/integrations';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GoogleCatalogueSyncProcessor } from './google-catalogue-sync.processor.js';

describe('GoogleCatalogueSyncProcessor', () => {
  const tenantId = '22222222-2222-4222-8222-222222222222';
  const sourceId = '44444444-4444-4444-8444-444444444444';
  const mappingId = '55555555-5555-4555-8555-555555555555';
  const headers = ['SKU', 'Name'];
  const fingerprint = googleSheetsStructureFingerprint(headers);
  const source = { id: sourceId, tenantId, type: 'GOOGLE_SHEETS', spreadsheetId: 'sheet-id', sheetName: 'Products', status: 'ACTIVE' };
  const mapping = {
    id: mappingId,
    sourceFingerprint: fingerprint,
    columns: [{ source: 'sku', target: 'sku' }, { source: 'name', target: 'name' }],
    transformSettings: { clearEmptyFields: [] },
    confirmedAt: new Date('2026-09-01T08:00:00.000Z'),
  };
  let prisma: ReturnType<typeof prismaDouble>;
  let sheets: { readTable: ReturnType<typeof vi.fn> };
  let importer: { importTable: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    prisma = prismaDouble();
    sheets = { readTable: vi.fn().mockResolvedValue({ headers, rows: [['LUNA-01', 'Luna']], revision: 'revision-1' }) };
    importer = { importTable: vi.fn().mockResolvedValue({ totalRows: 1, validRows: 1, createdRows: 1, updatedRows: 0, skippedRows: 0, failedRows: 0, rowErrors: [] }) };
  });

  it('reuses a confirmed mapping when the normalized structure is unchanged', async () => {
    const processor = new GoogleCatalogueSyncProcessor(prisma as never, sheets as never, importer);

    await expect(processor.process({ tenantId, sourceId })).resolves.toMatchObject({ status: 'COMPLETED', revision: 'revision-1' });
    expect(importer.importTable).toHaveBeenCalledWith(expect.objectContaining({
      tenantId, sourceId, headers, rows: [['LUNA-01', 'Luna']], mapping: mapping.columns,
    }));
    expect(prisma.catalogueImportRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      tenantId, sourceId, mappingId, status: 'PROCESSING', idempotencyKey: `google:${sourceId}:revision-1`, sourceRevision: 'revision-1',
    }) });
    expect(prisma.catalogueSource.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE', lastErrorSummary: null }) }));
  });

  it('pauses for mapping review before mutation when the structure changes', async () => {
    sheets.readTable.mockResolvedValue({ headers: ['SKU', 'Product name', 'Price'], rows: [['LUNA-01', 'Luna', 20]], revision: 'revision-2' });
    const processor = new GoogleCatalogueSyncProcessor(prisma as never, sheets as never, importer);

    await expect(processor.process({ tenantId, sourceId })).resolves.toMatchObject({ status: 'MAPPING_REVIEW' });
    expect(importer.importTable).not.toHaveBeenCalled();
    expect(prisma.catalogueImportRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'MAPPING_REVIEW', mappingId: null }) });
    expect(prisma.catalogueSource.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PAUSED', lastErrorSummary: 'STRUCTURE_CHANGED' }) }));
  });

  it('does not import a revision that already completed', async () => {
    prisma.catalogueImportRun.findUnique.mockResolvedValue({ id: 'existing-run', status: 'COMPLETED' });
    const processor = new GoogleCatalogueSyncProcessor(prisma as never, sheets as never, importer);

    await expect(processor.process({ tenantId, sourceId })).resolves.toEqual({ status: 'NOOP', revision: 'revision-1' });
    expect(importer.importTable).not.toHaveBeenCalled();
    expect(prisma.catalogueImportRun.create).not.toHaveBeenCalled();
  });

  it('pauses safely when the confirmed mapping lacks required columns', async () => {
    prisma.catalogueMapping.findFirst.mockResolvedValue({ ...mapping, columns: [{ source: 'sku', target: 'sku' }] });
    const processor = new GoogleCatalogueSyncProcessor(prisma as never, sheets as never, importer);

    await expect(processor.process({ tenantId, sourceId })).resolves.toMatchObject({ status: 'MAPPING_REVIEW' });
    expect(importer.importTable).not.toHaveBeenCalled();
    expect(prisma.catalogueSource.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lastErrorSummary: 'MISSING_REQUIRED_COLUMNS' }) }));
  });

  it('keeps the previous catalogue and exposes only a retryable category on Google failure', async () => {
    sheets.readTable.mockRejectedValue(new GoogleSheetsReadError('RATE_LIMIT', true));
    const processor = new GoogleCatalogueSyncProcessor(prisma as never, sheets as never, importer);

    await expect(processor.process({ tenantId, sourceId })).rejects.toMatchObject({ code: 'RATE_LIMIT', retryable: true });
    expect(importer.importTable).not.toHaveBeenCalled();
    expect(prisma.catalogueSource.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'ERROR', lastErrorSummary: 'RATE_LIMIT' } }));
  });

  it('rejects an SKU collision owned by another source before upsert', async () => {
    prisma.product.findMany.mockResolvedValue([{ sku: 'LUNA-01', sourceId: '66666666-6666-4666-8666-666666666666' }]);
    const processor = new GoogleCatalogueSyncProcessor(prisma as never, sheets as never, importer);

    await expect(processor.process({ tenantId, sourceId })).resolves.toMatchObject({ status: 'FAILED' });
    expect(importer.importTable).not.toHaveBeenCalled();
    expect(prisma.catalogueSource.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lastErrorSummary: 'SKU_COLLISION' }) }));
  });

  function prismaDouble() {
    return {
      catalogueSource: {
        findFirst: vi.fn().mockResolvedValue(source),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      catalogueMapping: { findFirst: vi.fn().mockResolvedValue(mapping) },
      catalogueImportRun: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'run-1', ...data })),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      product: { findMany: vi.fn().mockResolvedValue([]) },
    };
  }
});
