import { describe, expect, it, vi } from 'vitest';

import { GoogleSheetsSettingsService } from './google-sheets-settings.service.js';
import { OrderSettingsService } from './order-settings.service.js';

describe('settings tenant scope', () => {
  it('creates default order settings for a tenant that does not have them yet', async () => {
    const tenantId = '22222222-2222-4222-8222-222222222222';
    const upsert = vi.fn().mockResolvedValue({
      intentDetectionMode: 'PHRASE_ONLY',
      approvalMode: 'ALWAYS',
      autoApprovalThreshold: 0.9,
      promptVersion: 'instagram-order-v2',
      triggerPhrases: ['беремо замовлення в роботу', 'замовлення прийнято'],
    });
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      tenantSettings: { upsert },
    };
    const service = new OrderSettingsService({
      $transaction: vi.fn(async (operation) => operation(transaction)),
    } as never);

    const settings = await service.get(tenantId);

    expect(settings).toEqual({
      intentDetectionMode: 'PHRASE_ONLY',
      approvalMode: 'ALWAYS',
      autoApprovalThreshold: 0.9,
      promptVersion: 'instagram-order-v2',
      triggerPhrases: ['беремо замовлення в роботу', 'замовлення прийнято'],
    });
    expect(upsert).toHaveBeenCalledWith({
      where: { tenantId },
      update: {},
      create: {
        tenantId,
        intentDetectionMode: 'PHRASE_ONLY',
        approvalMode: 'ALWAYS',
        autoApprovalThreshold: 0.9,
        promptVersion: 'instagram-order-v2',
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
