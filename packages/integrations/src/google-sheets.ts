import { GoogleAuth } from 'google-auth-library';

interface AccessTokenProvider { getAccessToken(): Promise<string> }
type FetchLike = (input: string, init: { headers: { authorization: string; 'content-type'?: string }; method?: string; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type GoogleSheetsUpsertResult = { action: 'appended' | 'updated'; rowNumber: number };

export class GoogleSheetsAdapter {
  constructor(private readonly auth: AccessTokenProvider, private readonly fetchFn: FetchLike = fetch) {}

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
