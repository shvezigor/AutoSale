import { CatalogueSkuOwnershipError } from '@autosale/database';
import { GoogleSheetsReadError, GoogleSheetsTableValidationError, googleSheetsStructureFingerprint } from '@autosale/integrations';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GoogleCatalogueSyncProcessor } from './google-catalogue-sync.processor.js';

describe('GoogleCatalogueSyncProcessor', () => {
  const tenantId = '22222222-2222-4222-8222-222222222222';
  const sourceId = '44444444-4444-4444-8444-444444444444';
  const mappingId = '55555555-5555-4555-8555-555555555555';
  const headers = ['SKU', 'Name'];
  const fingerprint = googleSheetsStructureFingerprint(headers);
  const source = { id: sourceId, tenantId, type: 'GOOGLE_SHEETS', spreadsheetId: 'sheet-id', sheetName: 'Products', credentialRef: null, status: 'ACTIVE' };
  const mapping = {
    id: mappingId,
    version: 1,
    sourceFingerprint: fingerprint,
    columns: [{ source: 'sku', target: 'sku' }, { source: 'name', target: 'name' }],
    transformSettings: { clearEmptyFields: [] },
    confirmedAt: new Date('2026-09-01T08:00:00.000Z'),
  };
  let prisma: ReturnType<typeof prismaDouble>;
  let sheets: { readTable: ReturnType<typeof vi.fn> };
  let importer: { importTable: ReturnType<typeof vi.fn> };
  let storage: { put: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    prisma = prismaDouble();
    sheets = { readTable: vi.fn().mockResolvedValue({ headers, rows: [['LUNA-01', 'Luna']], revision: 'revision-1' }) };
    importer = { importTable: vi.fn().mockResolvedValue({ totalRows: 1, validRows: 1, createdRows: 1, updatedRows: 0, skippedRows: 0, failedRows: 0, rowErrors: [] }) };
    storage = { put: vi.fn().mockResolvedValue({ key: 'snapshot', etag: 'etag' }) };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reuses a confirmed mapping when the normalized structure is unchanged', async () => {
    const processor = new GoogleCatalogueSyncProcessor(prisma as never, sheets as never, storage, importer);

    await expect(processor.process({ tenantId, sourceId })).resolves.toMatchObject({ status: 'COMPLETED', revision: 'revision-1' });
    expect(importer.importTable).toHaveBeenCalledWith(expect.objectContaining({
      tenantId, sourceId, headers, rows: [['LUNA-01', 'Luna']], mapping: mapping.columns,
      ownershipPolicy: 'FENCE_CROSS_SOURCE', lease: expect.objectContaining({ syncVersion: 2, ttlMs: 300_000 }),
    }));
    expect(prisma.catalogueImportRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      tenantId, sourceId, mappingId, status: 'PROCESSING', idempotencyKey: `google:${sourceId}:revision-1:mapping:1`, sourceRevision: 'revision-1',
    }) });
    expect(prisma.catalogueSource.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE', lastErrorSummary: null }) }));
  });

  it('resolves tenant OAuth credentials for every synchronization without putting tokens in job data', async () => {
    prisma.catalogueSource.findFirst.mockResolvedValue({
      ...source, credentialRef: 'connection-a', syncVersion: 1, syncSchedule: 'MANUAL', syncLeaseId: null, syncLeaseExpiresAt: null,
    });
    const oauthSheets = vi.fn().mockResolvedValue(sheets);
    const processor = new GoogleCatalogueSyncProcessor(prisma as never, undefined, storage, importer, oauthSheets);

    await expect(processor.process({ tenantId, sourceId })).resolves.toMatchObject({ status: 'COMPLETED' });

    expect(oauthSheets).toHaveBeenCalledWith(tenantId, 'connection-a');
    expect(sheets.readTable).toHaveBeenCalledWith({ spreadsheetId: 'sheet-id', sheetName: 'Products', maxRows: 5_000 });
  });

  it('pauses for mapping review before mutation when the structure changes', async () => {
    sheets.readTable.mockResolvedValue({ headers: ['SKU', 'Product name', 'Price'], rows: [['LUNA-01', 'Luna', 20]], revision: 'revision-2' });
    const processor = new GoogleCatalogueSyncProcessor(prisma as never, sheets as never, storage, importer);

    await expect(processor.process({ tenantId, sourceId })).resolves.toMatchObject({ status: 'MAPPING_REVIEW' });
    expect(importer.importTable).not.toHaveBeenCalled();
    expect(prisma.catalogueImportRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'MAPPING_REVIEW', mappingId: null }) });
    expect(prisma.catalogueSource.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PAUSED', lastErrorSummary: 'STRUCTURE_CHANGED' }) }));
  });

  it('does not import a revision that already completed', async () => {
    prisma.catalogueImportRun.findUnique.mockResolvedValue({ id: 'existing-run', status: 'COMPLETED' });
    const processor = new GoogleCatalogueSyncProcessor(prisma as never, sheets as never, storage, importer);

    await expect(processor.process({ tenantId, sourceId })).resolves.toMatchObject({ status: 'NOOP', revision: 'revision-1' });
    expect(importer.importTable).not.toHaveBeenCalled();
    expect(prisma.catalogueImportRun.create).not.toHaveBeenCalled();
  });

  it('refreshes and exposes an existing owner preview instead of deadlocking on its idempotency key', async () => {
    prisma.catalogueImportRun.findUnique.mockResolvedValue({ id: 'preview-run', status: 'PREVIEW_READY', sourceSyncVersion: 1 });
    const processor = new GoogleCatalogueSyncProcessor(prisma as never, sheets as never, storage, importer);

    await expect(processor.process({ tenantId, sourceId })).resolves.toMatchObject({ status: 'PREVIEW_READY', runId: 'preview-run' });
    expect(importer.importTable).not.toHaveBeenCalled();
    expect(prisma.catalogueImportRun.create).not.toHaveBeenCalled();
    expect(prisma.catalogueImportRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'preview-run', tenantId, status: 'PREVIEW_READY' },
      data: expect.objectContaining({ sourceSyncVersion: 2, snapshotObjectKey: expect.any(String) }),
    }));
  });

  it('does not let manual and scheduled jobs concurrently claim the same source version', async () => {
    let claims = 0;
    prisma.catalogueSource.updateMany.mockImplementation(({ data }) => Promise.resolve(data.syncVersion ? { count: ++claims === 1 ? 1 : 0 } : { count: 1 }));
    const processor = new GoogleCatalogueSyncProcessor(prisma as never, sheets as never, storage, importer);

    const [first, second] = await Promise.all([
      processor.process({ tenantId, sourceId }),
      processor.process({ tenantId, sourceId }),
    ]);

    expect([first.status, second.status]).toEqual(expect.arrayContaining(['COMPLETED', 'BUSY']));
    expect(importer.importTable).toHaveBeenCalledTimes(1);
  });

  it('renews a long import lease so a competing claimant remains fenced after more than five minutes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T08:00:00.000Z'));
    const leaseState: { id: string | null; expiresAt: number; version: number } = { id: null, expiresAt: 0, version: 1 };
    prisma.catalogueSource.findFirst.mockImplementation(async () => ({
      ...source, syncVersion: leaseState.version, syncSchedule: 'MANUAL', syncLeaseId: leaseState.id,
      syncLeaseExpiresAt: leaseState.id ? new Date(leaseState.expiresAt) : null,
    }));
    prisma.catalogueSource.updateMany.mockImplementation(async ({ where, data }) => {
      if (data.syncVersion?.increment) {
        if (where.syncVersion !== leaseState.version || (leaseState.id && leaseState.expiresAt > Date.now())) return { count: 0 };
        leaseState.id = data.syncLeaseId;
        leaseState.expiresAt = data.syncLeaseExpiresAt.getTime();
        leaseState.version += 1;
        return { count: 1 };
      }
      if (data.syncLeaseExpiresAt instanceof Date && data.syncLeaseId === undefined) {
        if (where.syncLeaseId !== leaseState.id || where.syncVersion !== leaseState.version || leaseState.expiresAt <= Date.now()) return { count: 0 };
        leaseState.expiresAt = data.syncLeaseExpiresAt.getTime();
        return { count: 1 };
      }
      if (where.syncLeaseId !== leaseState.id || where.syncVersion !== leaseState.version) return { count: 0 };
      if (data.syncLeaseId === null) { leaseState.id = null; leaseState.expiresAt = 0; }
      return { count: 1 };
    });
    let finishImport!: (value: CatalogueImportCountsFixture) => void;
    importer.importTable.mockImplementation(() => importer.importTable.mock.calls.length === 1
      ? new Promise((resolve) => { finishImport = resolve; })
      : Promise.resolve({ totalRows: 1, validRows: 1, createdRows: 1, updatedRows: 0, skippedRows: 0, failedRows: 0, rowErrors: [] }));
    const firstProcessor = new GoogleCatalogueSyncProcessor(prisma as never, sheets as never, storage, importer);
    const first = firstProcessor.process({ tenantId, sourceId });
    for (let turn = 0; turn < 20 && importer.importTable.mock.calls.length === 0; turn += 1) await Promise.resolve();
    expect(importer.importTable).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(6 * 60_000);
    const competitor = new GoogleCatalogueSyncProcessor(prisma as never, sheets as never, storage, importer);
    await expect(competitor.process({ tenantId, sourceId })).resolves.toEqual({ status: 'BUSY' });

    finishImport({ totalRows: 1, validRows: 1, createdRows: 1, updatedRows: 0, skippedRows: 0, failedRows: 0, rowErrors: [] });
    await expect(first).resolves.toMatchObject({ status: 'COMPLETED' });
  });

  it('retries a failed run and recovers stale processing while a fresh processing run stays in progress', async () => {
    prisma.catalogueImportRun.findUnique
      .mockResolvedValueOnce({ id: 'failed-run', status: 'FAILED', mappingId, startedAt: new Date(Date.now() - 60 * 60_000) })
      .mockResolvedValueOnce({ id: 'stale-run', status: 'PROCESSING', mappingId, startedAt: new Date(Date.now() - 60 * 60_000) })
      .mockResolvedValueOnce({ id: 'fresh-run', status: 'PROCESSING', mappingId, startedAt: new Date() });
    const processor = new GoogleCatalogueSyncProcessor(prisma as never, sheets as never, storage, importer);

    await expect(processor.process({ tenantId, sourceId })).resolves.toMatchObject({ status: 'COMPLETED' });
    await expect(processor.process({ tenantId, sourceId })).resolves.toMatchObject({ status: 'COMPLETED' });
    await expect(processor.process({ tenantId, sourceId })).resolves.toMatchObject({ status: 'PROCESSING' });
    expect(importer.importTable).toHaveBeenCalledTimes(2);
  });

  it('includes the confirmed mapping version in idempotency and does not advance lastSyncedAt on a completed no-op', async () => {
    prisma.catalogueMapping.findFirst.mockResolvedValue({ ...mapping, version: 7 });
    prisma.catalogueImportRun.findUnique.mockResolvedValue({ id: 'existing-run', status: 'COMPLETED', mappingId, startedAt: new Date() });
    const processor = new GoogleCatalogueSyncProcessor(prisma as never, sheets as never, storage, importer);

    await expect(processor.process({ tenantId, sourceId })).resolves.toMatchObject({ status: 'NOOP' });
    expect(prisma.catalogueImportRun.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: `google:${sourceId}:revision-1:mapping:7` } },
    }));
    expect(prisma.catalogueSource.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ lastSyncedAt: expect.anything() }),
    }));
  });

  it('pauses safely when the confirmed mapping lacks required columns', async () => {
    prisma.catalogueMapping.findFirst.mockResolvedValue({ ...mapping, columns: [{ source: 'sku', target: 'sku' }] });
    const processor = new GoogleCatalogueSyncProcessor(prisma as never, sheets as never, storage, importer);

    await expect(processor.process({ tenantId, sourceId })).resolves.toMatchObject({ status: 'MAPPING_REVIEW' });
    expect(importer.importTable).not.toHaveBeenCalled();
    expect(prisma.catalogueSource.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lastErrorSummary: 'MISSING_REQUIRED_COLUMNS' }) }));
  });

  it('keeps the previous catalogue and exposes only a retryable category on Google failure', async () => {
    sheets.readTable.mockRejectedValue(new GoogleSheetsReadError('RATE_LIMIT', true));
    const processor = new GoogleCatalogueSyncProcessor(prisma as never, sheets as never, storage, importer);

    await expect(processor.process({ tenantId, sourceId })).rejects.toMatchObject({ code: 'RATE_LIMIT', retryable: true });
    expect(importer.importTable).not.toHaveBeenCalled();
    expect(prisma.catalogueSource.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'ERROR', lastErrorSummary: 'RATE_LIMIT' }) }));
  });

  it('pauses without a provider retry when the downloaded table violates local structure bounds', async () => {
    sheets.readTable.mockRejectedValue(new GoogleSheetsTableValidationError('COLUMN_LIMIT', 'Google Sheets table exceeds 100 columns'));
    const processor = new GoogleCatalogueSyncProcessor(prisma as never, sheets as never, storage, importer);

    await expect(processor.process({ tenantId, sourceId })).resolves.toMatchObject({
      status: 'FAILED', reason: 'TABLE_VALIDATION', validationCode: 'COLUMN_LIMIT',
    });
    expect(importer.importTable).not.toHaveBeenCalled();
    expect(prisma.catalogueSource.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PAUSED', lastErrorSummary: 'TABLE_COLUMN_LIMIT' }),
    }));
  });

  it('releases its source lease when persisting a review snapshot fails', async () => {
    storage.put.mockRejectedValue(new Error('storage unavailable'));
    const processor = new GoogleCatalogueSyncProcessor(prisma as never, sheets as never, storage, importer);

    await expect(processor.process({ tenantId, sourceId })).rejects.toThrow('Catalogue snapshot could not be stored');
    expect(importer.importTable).not.toHaveBeenCalled();
    expect(prisma.catalogueSource.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'ERROR', lastErrorSummary: 'SNAPSHOT_WRITE_FAILED', syncLeaseId: null, syncLeaseExpiresAt: null }),
    }));
  });

  it('rejects an SKU collision owned by another source before upsert', async () => {
    importer.importTable.mockRejectedValue(new CatalogueSkuOwnershipError());
    const processor = new GoogleCatalogueSyncProcessor(prisma as never, sheets as never, storage, importer);

    await expect(processor.process({ tenantId, sourceId })).resolves.toMatchObject({ status: 'FAILED' });
    expect(importer.importTable).toHaveBeenCalledOnce();
    expect(prisma.catalogueSource.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lastErrorSummary: 'SKU_COLLISION' }) }));
  });

  function prismaDouble() {
    const delegates = {
      catalogueSource: {
        findFirst: vi.fn().mockResolvedValue({ ...source, syncVersion: 1, syncSchedule: 'MANUAL', syncLeaseId: null, syncLeaseExpiresAt: null }),
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
    return { ...delegates, $transaction: vi.fn().mockImplementation((work) => work(delegates)) };
  }
});

type CatalogueImportCountsFixture = {
  totalRows: number; validRows: number; createdRows: number; updatedRows: number; skippedRows: number; failedRows: number;
  rowErrors: Array<{ rowNumber?: number; errors: string[] }>;
};
