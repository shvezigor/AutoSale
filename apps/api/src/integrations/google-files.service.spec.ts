import { describe, expect, it, vi } from 'vitest';

import { GoogleFilesService } from './google-files.service.js';

const metadata = {
  spreadsheetId: 'sheet-a',
  displayName: 'Каталог',
  tabs: [{ sheetId: 1, title: 'Товари' }],
};

describe('GoogleFilesService', () => {
  it('returns only server-verified spreadsheet metadata for the current tenant', async () => {
    const tokens = { getAccessToken: vi.fn().mockResolvedValue('access-a') };
    const files = { inspectSpreadsheet: vi.fn().mockResolvedValue(metadata) };
    const service = new GoogleFilesService(tokens, files);

    await expect(service.getTabs('tenant-a', 'sheet-a')).resolves.toEqual(metadata);
    expect(tokens.getAccessToken).toHaveBeenCalledWith('tenant-a');
    expect(files.inspectSpreadsheet).toHaveBeenCalledWith('access-a', 'sheet-a');
  });

  it.each([
    ['an inaccessible file', new Error('not found')],
    ['a non-spreadsheet file', new Error('unsupported type')],
    ['a deleted file', new Error('trashed')],
  ])('returns one privacy-safe error for %s', async (_label, providerError) => {
    const service = new GoogleFilesService(
      { getAccessToken: vi.fn().mockResolvedValue('access-a') },
      { inspectSpreadsheet: vi.fn().mockRejectedValue(providerError) },
    );

    await expect(service.getTabs('tenant-a', 'sheet-a')).rejects.toMatchObject({ message: 'Google spreadsheet is unavailable' });
  });

  it('does not fall back to another tenant when the current tenant has no connection', async () => {
    const files = { inspectSpreadsheet: vi.fn() };
    const service = new GoogleFilesService(
      { getAccessToken: vi.fn().mockRejectedValue(new Error('not connected')) },
      files,
    );

    await expect(service.getTabs('tenant-b', 'sheet-a')).rejects.toMatchObject({ message: 'Google spreadsheet is unavailable' });
    expect(files.inspectSpreadsheet).not.toHaveBeenCalled();
  });
});
