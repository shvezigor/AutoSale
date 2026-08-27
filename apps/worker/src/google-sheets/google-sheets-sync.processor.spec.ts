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
      orderExport: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'export-1', orderId: 'order-42' }), update },
      order: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'order-42', status: 'APPROVED', extraction: {}, items: [] }) },
      googleSheetsDestination: { findUniqueOrThrow: vi.fn().mockResolvedValue({ spreadsheetId: 'sheet-id', sheetName: 'Orders', requiredHeaders: ['order_id'] }) },
    };
    const sheets = { upsertRow: vi.fn().mockRejectedValue(new Error('Google Sheets API returned HTTP 503')) };

    await expect(new GoogleSheetsSyncProcessor(prisma as never, sheets as never).process('export-1')).rejects.toThrow('HTTP 503');
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', errorSummary: 'Google Sheets API returned HTTP 503' }) }));
  });
});
