const SPREADSHEET_MIME_TYPE = 'application/vnd.google-apps.spreadsheet';

export type VerifiedSpreadsheet = {
  spreadsheetId: string;
  displayName: string;
  tabs: Array<{ sheetId: number; title: string }>;
};

export interface GoogleFilesClientPort {
  inspectSpreadsheet(accessToken: string, fileId: string): Promise<VerifiedSpreadsheet>;
}

export class GoogleFilesClient implements GoogleFilesClientPort {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async inspectSpreadsheet(accessToken: string, fileId: string): Promise<VerifiedSpreadsheet> {
    const encodedId = encodeURIComponent(fileId);
    const headers = { authorization: `Bearer ${accessToken}` };
    const driveResponse = await this.fetchFn(
      `https://www.googleapis.com/drive/v3/files/${encodedId}?fields=id,name,mimeType,trashed&supportsAllDrives=true`,
      { headers },
    );
    if (!driveResponse.ok) throw new Error('Google file lookup failed');
    const drive = await driveResponse.json() as { id?: unknown; name?: unknown; mimeType?: unknown; trashed?: unknown };
    if (drive.trashed === true) throw new Error('Google file is deleted');
    if (drive.mimeType !== SPREADSHEET_MIME_TYPE) throw new Error('Google file is not a spreadsheet');
    if (drive.id !== fileId || typeof drive.name !== 'string') throw new Error('Google file response invalid');

    const sheetsResponse = await this.fetchFn(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodedId}?fields=spreadsheetId,properties.title,sheets.properties(sheetId,title,hidden)`,
      { headers },
    );
    if (!sheetsResponse.ok) throw new Error('Google spreadsheet lookup failed');
    const spreadsheet = await sheetsResponse.json() as {
      spreadsheetId?: unknown;
      properties?: { title?: unknown };
      sheets?: Array<{ properties?: { sheetId?: unknown; title?: unknown; hidden?: unknown } }>;
    };
    if (spreadsheet.spreadsheetId !== fileId) throw new Error('Google spreadsheet response invalid');
    const tabs = (spreadsheet.sheets ?? []).flatMap(({ properties }) =>
      properties?.hidden !== true && typeof properties?.sheetId === 'number' && typeof properties.title === 'string'
        ? [{ sheetId: properties.sheetId, title: properties.title }]
        : []);
    if (tabs.length === 0) throw new Error('Google spreadsheet has no visible tabs');
    return {
      spreadsheetId: fileId,
      displayName: typeof spreadsheet.properties?.title === 'string' ? spreadsheet.properties.title : drive.name,
      tabs,
    };
  }
}
