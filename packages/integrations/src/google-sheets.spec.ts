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
});
