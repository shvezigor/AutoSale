import { describe, expect, it, vi } from 'vitest';

import { GoogleSheetsTableValidationError } from '@autosale/integrations';

import { CatalogueSourcesService } from './catalogue-sources.service.js';

describe('CatalogueSourcesService', () => {
  const tenantId = '22222222-2222-4222-8222-222222222222';
  const userId = '33333333-3333-4333-8333-333333333333';
  const sourceId = '44444444-4444-4444-8444-444444444444';

  it('creates a Google source from a full URL without touching credentials or the order destination', async () => {
    const created = {
      id: sourceId,
      tenantId,
      type: 'GOOGLE_SHEETS',
      displayName: 'Основний каталог',
      status: 'PENDING',
      spreadsheetId: '1AbC_def-123',
      sheetName: 'Товари',
      syncSchedule: 'HOURLY',
      lastSyncedAt: null,
      lastErrorSummary: null,
      updatedAt: new Date('2026-09-01T08:00:00.000Z'),
    };
    const prisma = {
      catalogueSource: { create: vi.fn().mockResolvedValue(created) },
      googleSheetsDestination: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    };
    const service = new CatalogueSourcesService(prisma as never, undefined, undefined, {
      serviceAccountEmail: 'catalogue-reader@example.iam.gserviceaccount.com',
    });

    await expect(service.create(tenantId, userId, {
      displayName: 'Основний каталог',
      spreadsheet: 'https://docs.google.com/spreadsheets/d/1AbC_def-123/edit#gid=0',
      sheetName: 'Товари',
      syncSchedule: 'HOURLY',
    })).resolves.toMatchObject({
      id: sourceId,
      spreadsheetId: '1AbC_def-123',
      sheetName: 'Товари',
      syncSchedule: 'HOURLY',
      serviceAccountEmail: 'catalogue-reader@example.iam.gserviceaccount.com',
      authorizationAction: 'SHARE_WITH_SERVICE_ACCOUNT',
    });
    expect(prisma.catalogueSource.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      tenantId,
      createdByUserId: userId,
      type: 'GOOGLE_SHEETS',
      displayName: 'Основний каталог',
      spreadsheetId: '1AbC_def-123',
      sheetName: 'Товари',
      syncSchedule: 'HOURLY',
      status: 'PENDING',
      nextSyncAt: expect.any(Date),
    }) });
    expect(prisma.googleSheetsDestination.findUnique).not.toHaveBeenCalled();
    expect(prisma.googleSheetsDestination.update).not.toHaveBeenCalled();
    expect(prisma.googleSheetsDestination.upsert).not.toHaveBeenCalled();
  });

  it('returns manager-safe health separately from owner-only configuration', async () => {
    const row = {
      id: sourceId, type: 'GOOGLE_SHEETS', displayName: 'Каталог', status: 'ACTIVE',
      spreadsheetId: 'private-sheet-id', sheetName: 'Товари', syncSchedule: 'DAILY',
      lastSyncedAt: new Date('2026-09-01T07:00:00.000Z'), lastErrorSummary: null,
      updatedAt: new Date('2026-09-01T08:00:00.000Z'),
    };
    const prisma = { catalogueSource: {
      findMany: vi.fn().mockResolvedValue([row]),
      findFirst: vi.fn().mockResolvedValue(row),
    }, catalogueImportRun: { findFirst: vi.fn().mockResolvedValue({ id: '77777777-7777-4777-8777-777777777777', status: 'PREVIEW_READY', sourceHeaders: ['sku', 'name'] }) } };
    const service = new CatalogueSourcesService(prisma as never, undefined, undefined, { serviceAccountEmail: 'reader@example.com' });

    const health = await service.listHealth(tenantId);
    expect(prisma.catalogueSource.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId, type: 'GOOGLE_SHEETS' } }));
    expect(health).toEqual([{
      id: sourceId, type: 'GOOGLE_SHEETS', displayName: 'Каталог', status: 'ACTIVE',
      lastSyncedAt: '2026-09-01T07:00:00.000Z', lastErrorSummary: null, updatedAt: '2026-09-01T08:00:00.000Z',
    }]);
    expect(JSON.stringify(health)).not.toContain('private-sheet-id');
    await expect(service.getConfiguration(tenantId, sourceId)).resolves.toMatchObject({
      spreadsheetId: 'private-sheet-id', sheetName: 'Товари', syncSchedule: 'DAILY', serviceAccountEmail: 'reader@example.com',
      pendingReview: { runId: '77777777-7777-4777-8777-777777777777', headers: ['sku', 'name'] },
    });
    expect(prisma.catalogueImportRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId, sourceId, status: { in: ['MAPPING_REVIEW', 'PREVIEW_READY'] } },
    }));
    expect(JSON.stringify(await service.getConfiguration(tenantId, sourceId))).not.toContain('private product');
  });

  it('tests connectivity without returning rows and records only a safe failure category', async () => {
    const source = { id: sourceId, spreadsheetId: 'sheet-id', sheetName: 'Товари' };
    const prisma = { catalogueSource: {
      findFirst: vi.fn().mockResolvedValue(source),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    } };
    const sheets = { readTable: vi.fn().mockResolvedValue({ headers: [' SKU ', 'Назва'], rows: [['SECRET-SKU', 'Secret name']], revision: 'row-revision' }) };
    const service = new CatalogueSourcesService(prisma as never, sheets as never, undefined, { serviceAccountEmail: 'reader@example.com' });

    const result = await service.checkConnectivity(tenantId, sourceId);
    expect(result).toEqual({ connected: true, headers: [' SKU ', 'Назва'], fingerprint: 'ac0978e54df0cb70f8f402d5402bf8636e56e3a585d36b045b1c97b4a4511b8c' });
    expect(JSON.stringify(result)).not.toContain('SECRET-SKU');
    expect(prisma.catalogueSource.updateMany).toHaveBeenCalledWith({
      where: { id: sourceId, tenantId, type: 'GOOGLE_SHEETS' },
      data: { status: 'ACTIVE', headerFingerprint: result.fingerprint, lastErrorSummary: null },
    });
  });

  it('reports local Google table structure violations as owner-fixable instead of retryable provider failures', async () => {
    const source = { id: sourceId, spreadsheetId: 'sheet-id', sheetName: 'Товари' };
    const prisma = { catalogueSource: {
      findFirst: vi.fn().mockResolvedValue(source), updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    } };
    const sheets = { readTable: vi.fn().mockRejectedValue(new GoogleSheetsTableValidationError('COLUMN_LIMIT', 'Google Sheets table exceeds 100 columns')) };
    const service = new CatalogueSourcesService(prisma as never, sheets as never);

    await expect(service.checkConnectivity(tenantId, sourceId)).rejects.toThrow('Google Sheets table structure is invalid');
    expect(prisma.catalogueSource.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'PAUSED', lastErrorSummary: 'TABLE_COLUMN_LIMIT' },
    }));
  });

  it('queues an idempotent manual synchronization using only internal ids', async () => {
    const prisma = { catalogueSource: { findFirst: vi.fn().mockResolvedValue({ id: sourceId }) } };
    const queue = { add: vi.fn().mockResolvedValue({ id: 'job' }) };
    const service = new CatalogueSourcesService(prisma as never, undefined, queue);

    await expect(service.synchronizeNow(tenantId, sourceId)).resolves.toEqual({ queued: true, sourceId });
    expect(queue.add).toHaveBeenCalledWith('catalogue.sync', { tenantId, sourceId }, expect.objectContaining({ jobId: `catalogue.sync:${sourceId}` }));
  });
});
