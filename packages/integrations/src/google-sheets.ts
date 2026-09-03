import { createHash } from 'node:crypto';

import { GoogleAuth } from 'google-auth-library';

import { GoogleOAuthAccessError } from './google-oauth-token-provider.js';

interface AccessTokenProvider { getAccessToken(): Promise<string> }
type FetchLike = (input: string, init: { headers: { authorization: string; 'content-type'?: string }; method?: string; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type GoogleSheetsUpsertResult = { action: 'appended' | 'updated'; rowNumber: number };
export type GoogleSheetsCell = string | number | boolean | null;
export type GoogleSheetsTable = { headers: string[]; rows: GoogleSheetsCell[][]; revision: string };
export type GoogleSheetsReadErrorCode = 'AUTHORIZATION' | 'NOT_FOUND' | 'RATE_LIMIT' | 'RETRYABLE';
export type GoogleSheetsTableValidationErrorCode = 'ROW_LIMIT' | 'COLUMN_LIMIT' | 'CELL_LIMIT' | 'HEADER_INVALID';
const MAX_TABLE_COLUMNS = 100;
const MAX_TABLE_CELL_CHARACTERS = 10_000;
const HEADER_SCAN_ROWS = 20;
/** Sparse rows are checked for 5,000 rows beyond the accepted table boundary. */
const TABLE_OVERFLOW_SCAN_ROWS = 5_000;

export function googleSheetsStructureFingerprint(headers: string[]): string {
  const normalized = headers.map((header) => header.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US'));
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export class GoogleSheetsReadError extends Error {
  override readonly name = 'GoogleSheetsReadError';

  constructor(readonly code: GoogleSheetsReadErrorCode, readonly retryable: boolean) {
    super({
      AUTHORIZATION: 'Google Sheets access is not authorized',
      NOT_FOUND: 'Google spreadsheet or tab was not found',
      RATE_LIMIT: 'Google Sheets rate limit was reached',
      RETRYABLE: 'Google Sheets is temporarily unavailable',
    }[code]);
  }
}

export class GoogleSheetsTableValidationError extends Error {
  override readonly name = 'GoogleSheetsTableValidationError';
  readonly retryable = false;

  constructor(readonly code: GoogleSheetsTableValidationErrorCode, message: string) {
    super(message);
  }
}

export class GoogleSheetsAdapter {
  constructor(private readonly auth: AccessTokenProvider, private readonly fetchFn: FetchLike = fetch) {}

  async readTable(input: { spreadsheetId: string; sheetName: string; maxRows: number }): Promise<GoogleSheetsTable> {
    if (!Number.isSafeInteger(input.maxRows) || input.maxRows < 1 || input.maxRows > 5_000) {
      throw new RangeError('Google Sheets row limit must be between 1 and 5000');
    }
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      const token = await this.auth.getAccessToken();
      const quotedSheet = `'${input.sheetName.replaceAll("'", "''")}'`;
      // A row-only range makes every populated column visible; the finite row end
      // also lets us detect sparse overflow without requesting an unbounded sheet.
      const range = encodeURIComponent(`${quotedSheet}!1:${input.maxRows + 1 + TABLE_OVERFLOW_SCAN_ROWS}`);
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.spreadsheetId)}/values/${range}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`;
      response = await this.fetchFn(url, { headers: { authorization: `Bearer ${token}` } });
    } catch (error) {
      if (error instanceof GoogleOAuthAccessError) throw new GoogleSheetsReadError('AUTHORIZATION', false);
      throw new GoogleSheetsReadError('RETRYABLE', true);
    }
    if (!response.ok) throw classifyReadFailure(response.status);
    let body: { values?: unknown[][] };
    try {
      body = await response.json() as { values?: unknown[][] };
    } catch {
      throw new GoogleSheetsReadError('RETRYABLE', true);
    }
    const values = Array.isArray(body.values) ? body.values.map((row) => Array.isArray(row) ? row.map(normalizeCell) : []) : [];
    if (values.some((row) => row.length > MAX_TABLE_COLUMNS)) {
      throw new GoogleSheetsTableValidationError('COLUMN_LIMIT', `Google Sheets table exceeds ${MAX_TABLE_COLUMNS} columns`);
    }
    if (values.some((row) => row.some((cell) => typeof cell === 'string' && cell.length > MAX_TABLE_CELL_CHARACTERS))) {
      throw new GoogleSheetsTableValidationError('CELL_LIMIT', 'Google Sheets cell exceeds the character limit');
    }
    const headerIndex = findHeaderRowIndex(values);
    const headers = (values[headerIndex] ?? []).map((value) => String(value ?? ''));
    const overflowRows = values.slice(headerIndex + input.maxRows + 1);
    if (overflowRows.some((row) => row.some((cell) => cell !== null && cell !== ''))) {
      throw new GoogleSheetsTableValidationError('ROW_LIMIT', `Google Sheets table exceeds ${input.maxRows} rows`);
    }
    const rows = values.slice(headerIndex + 1, headerIndex + input.maxRows + 1);
    if (headers.length > 0) {
      const normalizedHeaders = headers.map(normalizeHeader);
      if (normalizedHeaders.some((header) => header.length === 0)) {
        throw new GoogleSheetsTableValidationError('HEADER_INVALID', 'Google Sheets table contains an empty header');
      }
      if (new Set(normalizedHeaders).size !== normalizedHeaders.length) {
        throw new GoogleSheetsTableValidationError('HEADER_INVALID', 'Google Sheets table contains a duplicate header');
      }
    }
    return {
      headers,
      rows,
      revision: createHash('sha256').update(JSON.stringify({ headers, rows })).digest('hex'),
    };
  }

  async readHeader(input: { spreadsheetId: string; sheetName: string }): Promise<string[]> {
    const token = await this.auth.getAccessToken();
    const range = encodeURIComponent(`'${input.sheetName.replaceAll("'", "''")}'!1:1`);
    const response = await this.fetchFn(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.spreadsheetId)}/values/${range}`, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Google Sheets API returned HTTP ${response.status}`);
    const body = await response.json() as { values?: unknown[][] };
    return Array.isArray(body.values?.[0]) ? body.values[0].map(String) : [];
  }

  async upsertRow(input: { spreadsheetId: string; sheetName: string; orderId: string; values: Array<string | number | null> }): Promise<GoogleSheetsUpsertResult> {
    const token = await this.auth.getAccessToken();
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.spreadsheetId)}/values/`;
    const quotedSheet = `'${input.sheetName.replaceAll("'", "''")}'`;
    const idsResponse = await this.fetchFn(`${base}${encodeURIComponent(`${quotedSheet}!A:A`)}`, { headers: { authorization: `Bearer ${token}` } });
    if (!idsResponse.ok) throw new Error(`Google Sheets API returned HTTP ${idsResponse.status}`);
    const idsBody = await idsResponse.json() as { values?: unknown[][] };
    const rowIndex = idsBody.values?.findIndex((row) => String(row[0] ?? '') === input.orderId) ?? -1;
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const body = JSON.stringify({ values: [input.values] });
    const lastColumn = columnName(input.values.length);

    if (rowIndex >= 1) {
      const rowNumber = rowIndex + 1;
      const response = await this.fetchFn(`${base}${encodeURIComponent(`${quotedSheet}!A${rowNumber}:${lastColumn}${rowNumber}`)}?valueInputOption=RAW`, { method: 'PUT', headers, body });
      if (!response.ok) throw new Error(`Google Sheets API returned HTTP ${response.status}`);
      return { action: 'updated', rowNumber };
    }

    const response = await this.fetchFn(`${base}${encodeURIComponent(`${quotedSheet}!A:A`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { method: 'POST', headers, body });
    if (!response.ok) throw new Error(`Google Sheets API returned HTTP ${response.status}`);
    const result = await response.json() as { updates?: { updatedRange?: string } };
    return { action: 'appended', rowNumber: rowNumberFromRange(result.updates?.updatedRange) ?? (idsBody.values?.length ?? 1) + 1 };
  }
}

function findHeaderRowIndex(values: GoogleSheetsCell[][]): number {
  let bestIndex = 0;
  let bestScore = -1;
  for (const [index, row] of values.slice(0, HEADER_SCAN_ROWS).entries()) {
    const cells = row
      .filter((cell) => cell !== null && String(cell).trim() !== '')
      .map((cell) => String(cell).trim().toLocaleLowerCase());
    const semanticMatches = cells.filter((cell) =>
      HEADER_KEYWORDS.some((keyword) => cell.includes(keyword)),
    ).length;
    const contactMatches = cells.filter(
      (cell) => /(?:https?:\/\/|www\.|@|(?:\+?\d[\d\s().-]{7,}\d))/.test(cell),
    ).length;
    const score = semanticMatches * 100 + cells.length - contactMatches * 10;
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  }
  return bestIndex;
}

const HEADER_KEYWORDS = [
  'sku',
  'артикул',
  'код',
  'name',
  'назва',
  'наименование',
  'товар',
  'product',
  'асортимент',
  'ассортимент',
  'price',
  'ціна',
  'цена',
  'quantity',
  'кількість',
  'количество',
  'stock',
  'залишок',
  'остаток',
  'category',
  'категор',
  'brand',
  'бренд',
  'description',
  'опис',
  'currency',
  'валют',
];

function normalizeHeader(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

function classifyReadFailure(status: number): GoogleSheetsReadError {
  if (status === 401 || status === 403) return new GoogleSheetsReadError('AUTHORIZATION', false);
  if (status === 400 || status === 404) return new GoogleSheetsReadError('NOT_FOUND', false);
  if (status === 429) return new GoogleSheetsReadError('RATE_LIMIT', true);
  return new GoogleSheetsReadError('RETRYABLE', true);
}

function normalizeCell(value: unknown): GoogleSheetsCell {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null ? value : String(value ?? '');
}

function columnName(count: number): string {
  let result = '';
  for (let value = count; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
  return result;
}

function rowNumberFromRange(range: string | undefined): number | undefined {
  const match = range?.match(/![A-Z]+(\d+):/);
  return match ? Number(match[1]) : undefined;
}

export function createGoogleSheetsAdapter(keyFilename: string): GoogleSheetsAdapter {
  const auth = new GoogleAuth({ keyFilename, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  return new GoogleSheetsAdapter({ getAccessToken: async () => {
    const token = await auth.getAccessToken();
    if (!token) throw new Error('Google service account did not return an access token');
    return token;
  } });
}
