import { describe, expect, it, vi } from 'vitest';

import { GoogleSheetsSettingsService } from './google-sheets-settings.service.js';
import { OrderSettingsService } from './order-settings.service.js';

describe('settings tenant scope', () => {
  it('queries order settings by the tenant supplied for this request', async () => {
    const findUniqueOrThrow = vi.fn().mockResolvedValue({ approvalMode: 'ALWAYS', autoApprovalThreshold: 0.9, promptVersion: 'v1', triggerPhrases: [] });
    const service = new OrderSettingsService({ tenantSettings: { findUniqueOrThrow } } as never);

    await service.get('tenant-b');

    expect(findUniqueOrThrow).toHaveBeenCalledWith({ where: { tenantId: 'tenant-b' } });
  });

  it('creates a Google Sheets destination only for the supplied tenant', async () => {
    const upsert = vi.fn().mockResolvedValue({ spreadsheetId: 'sheet-id', sheetName: 'Orders', status: 'PENDING', requiredHeaders: [], lastValidatedAt: null, errorSummary: null });
    const service = new GoogleSheetsSettingsService({ googleSheetsDestination: { upsert } } as never);

    await service.update('tenant-b', { spreadsheetId: 'sheet-id', sheetName: 'Orders' });

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-b' },
      create: expect.objectContaining({ tenantId: 'tenant-b' }),
    }));
  });
});
