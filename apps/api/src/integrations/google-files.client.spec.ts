import { describe, expect, it, vi } from 'vitest';

import { GoogleFilesClient } from './google-files.client.js';

describe('GoogleFilesClient', () => {
  it('checks Drive type and deletion state before reading Sheets tabs', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'sheet-a', name: 'Каталог', mimeType: 'application/vnd.google-apps.spreadsheet', trashed: false }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ spreadsheetId: 'sheet-a', properties: { title: 'Каталог' }, sheets: [{ properties: { sheetId: 1, title: 'Товари', hidden: false } }] }), { status: 200 }));
    const client = new GoogleFilesClient(fetchFn);

    await expect(client.inspectSpreadsheet('access-a', 'sheet-a')).resolves.toEqual({
      spreadsheetId: 'sheet-a', displayName: 'Каталог', tabs: [{ sheetId: 1, title: 'Товари' }],
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[0]?.[1]?.headers).toEqual({ authorization: 'Bearer access-a' });
  });

  it('rejects a trashed or non-spreadsheet Drive item before calling Sheets', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'file-a', name: 'Notes', mimeType: 'text/plain', trashed: false }), { status: 200 }));
    const client = new GoogleFilesClient(fetchFn);

    await expect(client.inspectSpreadsheet('access-a', 'file-a')).rejects.toThrow('Google file is not a spreadsheet');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
