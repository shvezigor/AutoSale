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
    const tenantId = '55555555-5555-4555-8555-555555555555';
    const upsert = vi.fn().mockResolvedValue({ spreadsheetId: 'sheet-id', sheetName: 'Orders', status: 'PENDING', requiredHeaders: [], lastValidatedAt: null, errorSummary: null });
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      googleSheetsDestination: { upsert },
    };
    const service = new GoogleSheetsSettingsService({
      $transaction: vi.fn(async (operation) => operation(transaction)),
    } as never);

    await service.update(tenantId, { spreadsheetId: 'sheet-id', sheetName: 'Orders' });

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId },
      create: expect.objectContaining({ tenantId }),
    }));
  });
});
