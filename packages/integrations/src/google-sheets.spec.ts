import { describe, expect, it, vi } from 'vitest';

import { GoogleSheetsAdapter, GoogleSheetsReadError, GoogleSheetsTableValidationError } from './google-sheets.js';
import { GoogleOAuthAccessError } from './google-oauth-token-provider.js';

describe('GoogleSheetsAdapter', () => {
  it('reads a bounded evaluated table and returns a deterministic revision', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ values: [['SKU', 'Назва'], ['LUNA-01', 'Luna']] }),
    });
    const adapter = new GoogleSheetsAdapter({ getAccessToken: async () => 'token' }, fetchFn);

    await expect(adapter.readTable({ spreadsheetId: 'sheet-1', sheetName: 'Товари', maxRows: 5_000 })).resolves.toEqual({
      headers: ['SKU', 'Назва'],
      rows: [['LUNA-01', 'Luna']],
      revision: '505c4e531312346fc2a9c36b2cb78bb5299d0208a9a96f9bcc8b5d93ba1fcbbe',
    });
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining("values/'%D0%A2%D0%BE%D0%B2%D0%B0%D1%80%D0%B8'!1%3A10001"),
      expect.objectContaining({ headers: { authorization: 'Bearer token' } }),
    );
    expect(fetchFn.mock.calls[0]?.[0]).toContain('majorDimension=ROWS');
    expect(fetchFn.mock.calls[0]?.[0]).toContain('valueRenderOption=UNFORMATTED_VALUE');
  });

  it.each([
    [403, 'AUTHORIZATION', false],
    [400, 'NOT_FOUND', false],
    [404, 'NOT_FOUND', false],
    [429, 'RATE_LIMIT', true],
    [503, 'RETRYABLE', true],
  ] as const)('classifies HTTP %i table-read failures without exposing response data', async (status, code, retryable) => {
    const adapter = new GoogleSheetsAdapter({ getAccessToken: async () => 'token' }, vi.fn().mockResolvedValue({
      ok: false,
      status,
      json: async () => ({ error: { message: 'private response body' } }),
    }));

    const failure = adapter.readTable({ spreadsheetId: 'sheet-1', sheetName: 'Missing', maxRows: 10 });
    await expect(failure).rejects.toBeInstanceOf(GoogleSheetsReadError);
    await expect(failure).rejects.toMatchObject({ code, retryable });
    await expect(failure).rejects.not.toThrow(/private response body/i);
  });

  it('classifies network failures as retryable without exposing the underlying error', async () => {
    const adapter = new GoogleSheetsAdapter(
      { getAccessToken: async () => 'token' },
      vi.fn().mockRejectedValue(new Error('socket failure containing private URL')),
    );

    const failure = adapter.readTable({ spreadsheetId: 'sheet-1', sheetName: 'Products', maxRows: 10 });
    await expect(failure).rejects.toMatchObject({ code: 'RETRYABLE', retryable: true });
    await expect(failure).rejects.not.toThrow(/private URL/i);
  });

  it('classifies a rejected OAuth refresh as non-retryable authorization failure', async () => {
    const adapter = new GoogleSheetsAdapter({ getAccessToken: async () => { throw new GoogleOAuthAccessError(); } }, vi.fn());
    await expect(adapter.readTable({ spreadsheetId: 'sheet-1', sheetName: 'Products', maxRows: 10 }))
      .rejects.toMatchObject({ code: 'AUTHORIZATION', retryable: false });
  });

  it('quotes apostrophes in tab names and represents an empty sheet deterministically', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const adapter = new GoogleSheetsAdapter({ getAccessToken: async () => 'token' }, fetchFn);

    await expect(adapter.readTable({ spreadsheetId: 'sheet-1', sheetName: "Owner's Products", maxRows: 10 })).resolves.toEqual({
      headers: [], rows: [], revision: '63debde3011fa7ace0b1f7dad44f3a58bf5b8d8689dca36a2ba3b06fb137f563',
    });
    expect(fetchFn.mock.calls[0]?.[0]).toContain("'Owner''s%20Products'!1%3A5011");
  });

  it('rejects a response that exceeds the configured maximum rows', async () => {
    const adapter = new GoogleSheetsAdapter({ getAccessToken: async () => 'token' }, vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ values: [['SKU'], ['A'], ['B'], ['C']] }),
    }));
    await expect(adapter.readTable({ spreadsheetId: 'sheet-1', sheetName: 'Products', maxRows: 2 })).rejects.toThrow('exceeds 2 rows');
  });

  it('scans a finite 5000-row overflow window and rejects sparse data beyond the row cap', async () => {
    const sparseRows = [['SKU'], ['A'], ['B'], ...Array.from({ length: 4_999 }, () => []), ['OUTSIDE-LIMIT']];
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ values: sparseRows }),
    });
    const adapter = new GoogleSheetsAdapter({ getAccessToken: async () => 'token' }, fetchFn);

    await expect(adapter.readTable({ spreadsheetId: 'sheet-1', sheetName: 'Products', maxRows: 2 })).rejects.toThrow('exceeds 2 rows');
    expect(fetchFn.mock.calls[0]?.[0]).toContain("'Products'!1%3A5003");
  });

  it('requests complete rows so a populated 101st column cannot be hidden by the range', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ values: [Array.from({ length: 101 }, (_, index) => `column-${index}`)] }),
    });
    const adapter = new GoogleSheetsAdapter({ getAccessToken: async () => 'token' }, fetchFn);

    const failure = adapter.readTable({ spreadsheetId: 'sheet-1', sheetName: 'Products', maxRows: 10 });
    await expect(failure).rejects.toBeInstanceOf(GoogleSheetsTableValidationError);
    await expect(failure).rejects.toMatchObject({ code: 'COLUMN_LIMIT', retryable: false });
    expect(fetchFn.mock.calls[0]?.[0]).toContain("'Products'!1%3A5011");
  });

  it.each([
    [[['', 'Name']], 'empty'],
    [[[' SKU ', 'sku']], 'duplicate'],
    [[Array.from({ length: 101 }, (_, index) => `column-${index}`)], '100 columns'],
    [[['SKU'], ['x'.repeat(10_001)]], 'cell'],
  ] as const)('rejects invalid bounded table structures without returning row data: %s', async (values, message) => {
    const adapter = new GoogleSheetsAdapter({ getAccessToken: async () => 'token' }, vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ values }),
    }));

    const failure = adapter.readTable({ spreadsheetId: 'sheet-1', sheetName: 'Products', maxRows: 10 });
    await expect(failure).rejects.toBeInstanceOf(GoogleSheetsTableValidationError);
    await expect(failure).rejects.toMatchObject({ retryable: false });
    await expect(failure).rejects.toThrow(message);
  });

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
