import { describe, expect, it, vi } from 'vitest';

import { GoogleSheetsSettingsService } from './google-sheets-settings.service.js';
import { OrderSettingsService } from './order-settings.service.js';

describe('settings tenant scope', () => {
  it('creates default order settings for a tenant that does not have them yet', async () => {
    const upsert = vi.fn().mockResolvedValue({
      approvalMode: 'ALWAYS',
      autoApprovalThreshold: 0.9,
      promptVersion: 'instagram-order-v1',
      triggerPhrases: ['беремо замовлення в роботу', 'замовлення прийнято'],
    });
    const service = new OrderSettingsService({ tenantSettings: { upsert } } as never);

    const settings = await service.get('tenant-b');

    expect(settings).toEqual({
      approvalMode: 'ALWAYS',
      autoApprovalThreshold: 0.9,
      promptVersion: 'instagram-order-v1',
      triggerPhrases: ['беремо замовлення в роботу', 'замовлення прийнято'],
    });
    expect(upsert).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-b' },
      update: {},
      create: {
        tenantId: 'tenant-b',
        approvalMode: 'ALWAYS',
        autoApprovalThreshold: 0.9,
        promptVersion: 'instagram-order-v1',
        triggerPhrases: ['беремо замовлення в роботу', 'замовлення прийнято'],
      },
    });
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
