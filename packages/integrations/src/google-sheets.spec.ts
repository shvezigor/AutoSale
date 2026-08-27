import { describe, expect, it, vi } from 'vitest';

import { GoogleSheetsAdapter } from './google-sheets.js';

describe('GoogleSheetsAdapter', () => {
  it('reads the configured sheet header through the v4 values endpoint', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ values: [['order_id', 'status', 'sku']] }) });
    const adapter = new GoogleSheetsAdapter({ getAccessToken: async () => 'token' }, fetchFn);

    await expect(adapter.readHeader({ spreadsheetId: 'sheet-id', sheetName: 'Продажі' })).resolves.toEqual(['order_id', 'status', 'sku']);
    expect(fetchFn).toHaveBeenCalledWith("https://sheets.googleapis.com/v4/spreadsheets/sheet-id/values/'%D0%9F%D1%80%D0%BE%D0%B4%D0%B0%D0%B6%D1%96'!1%3A1", expect.objectContaining({ headers: { authorization: 'Bearer token' } }));
  });

  it('returns an actionable error when Google denies access', async () => {
    const adapter = new GoogleSheetsAdapter({ getAccessToken: async () => 'token' }, vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) }));
    await expect(adapter.readHeader({ spreadsheetId: 'forbidden', sheetName: 'Orders' })).rejects.toThrow('Google Sheets API returned HTTP 403');
  });

  it('appends a new order only after confirming its order_id is absent', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ values: [['order_id'], ['another-order']] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ updates: { updatedRange: "'Orders'!A3:C3" } }) });
    const adapter = new GoogleSheetsAdapter({ getAccessToken: async () => 'token' }, fetchFn);

    await expect(adapter.upsertRow({
      spreadsheetId: 'sheet-id', sheetName: 'Orders', orderId: 'order-42', values: ['order-42', 'APPROVED', 'SKU-7'],
    })).resolves.toEqual({ action: 'appended', rowNumber: 3 });

    expect(fetchFn.mock.calls[1]?.[0]).toContain("values/'Orders'!A%3AA:append");
    expect(fetchFn.mock.calls[1]?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ values: [['order-42', 'APPROVED', 'SKU-7']] }) });
  });

  it('updates the existing order row instead of appending a duplicate', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ values: [['order_id'], ['order-42']] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ updatedRange: "'Orders'!A2:C2" }) });
    const adapter = new GoogleSheetsAdapter({ getAccessToken: async () => 'token' }, fetchFn);

    await expect(adapter.upsertRow({
      spreadsheetId: 'sheet-id', sheetName: 'Orders', orderId: 'order-42', values: ['order-42', 'APPROVED', 'SKU-7'],
    })).resolves.toEqual({ action: 'updated', rowNumber: 2 });

    expect(fetchFn.mock.calls[1]?.[0]).toContain("values/'Orders'!A2%3AC2?valueInputOption=RAW");
    expect(fetchFn.mock.calls[1]?.[1]).toMatchObject({ method: 'PUT' });
  });
});
