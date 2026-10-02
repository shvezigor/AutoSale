import { describe, expect, it, vi } from 'vitest';

import { GoogleSheetsSyncProcessor } from './google-sheets-sync.processor.js';

const tenantId = '11111111-1111-4111-8111-111111111111';

describe('GoogleSheetsSyncProcessor', () => {
  it('maps an approved order to configured headers and records a successful export', async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      orderExport: { findFirstOrThrow: vi.fn().mockResolvedValue({ id: 'export-1', orderId: 'order-42', tenantId }), update },
      order: { findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: 'order-42', publicNumber: 'AS-260918', status: 'APPROVED',
        createdAt: new Date('2026-09-18T19:10:54.817Z'), approvedAt: new Date('2026-09-18T19:15:00Z'),
        extraction: { customer: { name: 'Олена', phone: '+380501112233', instagramUsername: 'olena' }, delivery: { city: 'Львів', novaPoshtaBranch: '12' } },
        items: [{ catalogId: 'SKU-7', quantity: 2, color: 'білий', size: null }],
      }) },
      googleSheetsDestination: { findUniqueOrThrow: vi.fn().mockResolvedValue({ spreadsheetId: 'sheet-id', sheetName: 'Orders', requiredHeaders: ['order_id', 'created_at', 'customer_name', 'phone', 'items'] }) },
      $queryRaw: vi.fn(),
      $transaction: vi.fn(),
    };
    prisma.$transaction.mockImplementation(async (run) => run(prisma));
    const sheets = { upsertRow: vi.fn().mockResolvedValue({ action: 'appended', rowNumber: 5 }) };

    await new GoogleSheetsSyncProcessor(prisma as never, sheets as never).process(tenantId, 'export-1');

    expect(sheets.upsertRow).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-id', sheetName: 'Orders', orderId: 'AS-260918', legacyOrderIds: ['order-42'],
      values: ['AS-260918', '18.09.2026, 22:10', 'Олена', '+380501112233', 'SKU-7 × 2, білий'],
    });
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: 'export-1' }, data: expect.objectContaining({ status: 'SUCCEEDED', rowNumber: 5, errorSummary: null }) }));
  });

  it('keeps a safe failure state before rethrowing a retryable error', async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      orderExport: { findFirstOrThrow: vi.fn().mockResolvedValue({ id: 'export-1', orderId: 'order-42', tenantId }), update },
      order: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'order-42', status: 'APPROVED', approvedBy: 'user-a', extraction: {}, items: [] }) },
      googleSheetsDestination: { findUniqueOrThrow: vi.fn().mockResolvedValue({ spreadsheetId: 'sheet-id', sheetName: 'Orders', requiredHeaders: ['order_id'] }) },
      $queryRaw: vi.fn(),
      $transaction: vi.fn(),
    };
    prisma.$transaction.mockImplementation(async (run) => run(prisma));
    const sheets = { upsertRow: vi.fn().mockRejectedValue(new Error('Google Sheets API returned HTTP 503')) };
    const notifications = { orderExportFailed: vi.fn().mockResolvedValue(undefined) };

    await expect(new GoogleSheetsSyncProcessor(prisma as never, sheets as never, undefined, notifications as never).process(tenantId, 'export-1')).rejects.toThrow('HTTP 503');
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', errorSummary: 'Google Sheets API returned HTTP 503' }) }));
    expect(notifications.orderExportFailed).toHaveBeenCalledWith(tenantId, 'user-a', 'order-42');
  });

  it('resolves the destination tenant OAuth connection for each export', async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      orderExport: { findFirstOrThrow: vi.fn().mockResolvedValue({ id: 'export-1', orderId: 'order-42', tenantId }), update },
      order: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'order-42', tenantId, status: 'APPROVED', extraction: {}, items: [] }) },
      googleSheetsDestination: { findUniqueOrThrow: vi.fn().mockResolvedValue({ spreadsheetId: 'sheet-id', sheetName: 'Orders', credentialRef: 'connection-a', requiredHeaders: ['order_id'] }) },
      product: { findMany: vi.fn().mockResolvedValue([]) },
      $queryRaw: vi.fn(),
      $transaction: vi.fn(),
    };
    prisma.$transaction.mockImplementation(async (run) => run(prisma));
    const sheets = { upsertRow: vi.fn().mockResolvedValue({ action: 'appended', rowNumber: 2 }) };
    const oauthSheets = vi.fn().mockResolvedValue(sheets);

    await new GoogleSheetsSyncProcessor(prisma as never, undefined, oauthSheets).process(tenantId, 'export-1');

    expect(oauthSheets).toHaveBeenCalledWith(tenantId, 'connection-a');
    expect(sheets.upsertRow).toHaveBeenCalledOnce();
  });

  it('does not export a row when tenant ingestion is frozen', async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      orderExport: { findFirstOrThrow: vi.fn().mockResolvedValue({ id: 'export-1', orderId: 'order-42', tenantId }), update },
      tenantLifecycleRequest: { findFirst: vi.fn().mockResolvedValue({ id: 'delete-request' }) },
      $queryRaw: vi.fn(),
      $transaction: vi.fn(),
    };
    prisma.$transaction.mockImplementation(async (run) => run(prisma));
    const sheets = { upsertRow: vi.fn() };

    await expect(new GoogleSheetsSyncProcessor(prisma as never, sheets as never).process(tenantId, 'export-1'))
      .resolves.toBe('IGNORED_FROZEN');
    expect(sheets.upsertRow).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'FAILED', errorSummary: 'TENANT_LIFECYCLE_FROZEN' },
    }));
  });
});
