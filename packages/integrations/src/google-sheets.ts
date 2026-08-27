import { GoogleAuth } from 'google-auth-library';

interface AccessTokenProvider { getAccessToken(): Promise<string> }
type FetchLike = (input: string, init: { headers: { authorization: string } }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

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
}

export function createGoogleSheetsAdapter(keyFilename: string): GoogleSheetsAdapter {
  const auth = new GoogleAuth({ keyFilename, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  return new GoogleSheetsAdapter({ getAccessToken: async () => {
    const token = await auth.getAccessToken();
    if (!token) throw new Error('Google service account did not return an access token');
    return token;
  } });
}
