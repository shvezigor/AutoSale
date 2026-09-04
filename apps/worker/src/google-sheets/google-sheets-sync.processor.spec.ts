import { describe, expect, it, vi } from 'vitest';

import { GoogleSheetsSyncProcessor } from './google-sheets-sync.processor.js';

describe('GoogleSheetsSyncProcessor', () => {
  it('maps an approved order to configured headers and records a successful export', async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      orderExport: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'export-1', orderId: 'order-42' }), update },
      order: { findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: 'order-42', status: 'APPROVED', approvedAt: new Date('2026-08-27T08:00:00Z'),
        extraction: { customer: { name: 'Олена', phone: '+380501112233', instagramUsername: 'olena' }, delivery: { city: 'Львів', novaPoshtaBranch: '12' } },
        items: [{ catalogId: 'SKU-7', quantity: 2, color: 'білий', size: null }],
      }) },
      googleSheetsDestination: { findUniqueOrThrow: vi.fn().mockResolvedValue({ spreadsheetId: 'sheet-id', sheetName: 'Orders', requiredHeaders: ['order_id', 'customer_name', 'phone', 'items'] }) },
    };
    const sheets = { upsertRow: vi.fn().mockResolvedValue({ action: 'appended', rowNumber: 5 }) };

    await new GoogleSheetsSyncProcessor(prisma as never, sheets as never).process('export-1');

    expect(sheets.upsertRow).toHaveBeenCalledWith({ spreadsheetId: 'sheet-id', sheetName: 'Orders', orderId: 'order-42', values: ['order-42', 'Олена', '+380501112233', 'SKU-7 × 2, білий'] });
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: 'export-1' }, data: expect.objectContaining({ status: 'SUCCEEDED', rowNumber: 5, errorSummary: null }) }));
  });

  it('keeps a safe failure state before rethrowing a retryable error', async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      orderExport: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'export-1', orderId: 'order-42', tenantId: 'tenant-a' }), update },
      order: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'order-42', status: 'APPROVED', approvedBy: 'user-a', extraction: {}, items: [] }) },
      googleSheetsDestination: { findUniqueOrThrow: vi.fn().mockResolvedValue({ spreadsheetId: 'sheet-id', sheetName: 'Orders', requiredHeaders: ['order_id'] }) },
    };
    const sheets = { upsertRow: vi.fn().mockRejectedValue(new Error('Google Sheets API returned HTTP 503')) };
    const notifications = { orderExportFailed: vi.fn().mockResolvedValue(undefined) };

    await expect(new GoogleSheetsSyncProcessor(prisma as never, sheets as never, undefined, notifications as never).process('export-1')).rejects.toThrow('HTTP 503');
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', errorSummary: 'Google Sheets API returned HTTP 503' }) }));
    expect(notifications.orderExportFailed).toHaveBeenCalledWith('tenant-a', 'user-a', 'order-42');
  });

  it('resolves the destination tenant OAuth connection for each export', async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      orderExport: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'export-1', orderId: 'order-42', tenantId: 'tenant-a' }), update },
      order: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'order-42', tenantId: 'tenant-a', status: 'APPROVED', extraction: {}, items: [] }) },
      googleSheetsDestination: { findUniqueOrThrow: vi.fn().mockResolvedValue({ spreadsheetId: 'sheet-id', sheetName: 'Orders', credentialRef: 'connection-a', requiredHeaders: ['order_id'] }) },
      product: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const sheets = { upsertRow: vi.fn().mockResolvedValue({ action: 'appended', rowNumber: 2 }) };
    const oauthSheets = vi.fn().mockResolvedValue(sheets);

    await new GoogleSheetsSyncProcessor(prisma as never, undefined, oauthSheets).process('export-1');

    expect(oauthSheets).toHaveBeenCalledWith('tenant-a', 'connection-a');
    expect(sheets.upsertRow).toHaveBeenCalledOnce();
  });
});
