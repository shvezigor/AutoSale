import { describe, expect, it, vi } from 'vitest';

import { GoogleSheetsSettingsService } from './google-sheets-settings.service.js';

describe('GoogleSheetsSettingsService OAuth destination', () => {
  it('binds a Picker-verified destination to the active tenant connection', async () => {
    const row = { spreadsheetId: 'sheet-a', sheetName: 'Orders', credentialRef: 'connection-a', status: 'PENDING', requiredHeaders: [], lastValidatedAt: null, errorSummary: null };
    const prisma = {
      googleConnection: { findUnique: vi.fn().mockResolvedValue({ id: 'connection-a', status: 'ACTIVE' }) },
      googleSheetsDestination: { upsert: vi.fn().mockResolvedValue(row) },
    };
    const oauth = {
      verifySpreadsheet: vi.fn().mockResolvedValue({ tabs: [{ sheetId: 1, title: 'Orders' }] }),
      sheetsForConnection: vi.fn(),
    };
    const service = new GoogleSheetsSettingsService(prisma as never, undefined, { oauthRequired: true }, oauth);

    await service.update('tenant-a', { spreadsheetId: 'sheet-a', sheetName: 'Orders' });

    expect(oauth.verifySpreadsheet).toHaveBeenCalledWith('tenant-a', 'connection-a', 'sheet-a');
    expect(prisma.googleSheetsDestination.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ credentialRef: 'connection-a' }),
      update: expect.objectContaining({ credentialRef: 'connection-a' }),
    }));
  });

  it('validates headers through the destination tenant connection', async () => {
    const destination = { spreadsheetId: 'sheet-a', sheetName: 'Orders', credentialRef: 'connection-a', requiredHeaders: ['order_id'] };
    const prisma = {
      googleSheetsDestination: {
        findUnique: vi.fn().mockResolvedValue(destination),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const sheets = { readHeader: vi.fn().mockResolvedValue([
      'order_id', 'created_at', 'status', 'channel', 'conversation_id', 'customer_name', 'customer_phone',
      'sku', 'product_name', 'quantity', 'delivery_city', 'delivery_branch', 'manager_note', 'confidence', 'updated_at',
    ]) };
    const oauth = { verifySpreadsheet: vi.fn(), sheetsForConnection: vi.fn().mockResolvedValue(sheets) };
    const service = new GoogleSheetsSettingsService(prisma as never, undefined, { oauthRequired: true }, oauth);

    await expect(service.validate('tenant-a')).resolves.toMatchObject({ valid: true, status: 'ACTIVE' });
    expect(oauth.sheetsForConnection).toHaveBeenCalledWith('tenant-a', 'connection-a');
  });

  it('initializes an empty destination with the AutoSale template before activating it', async () => {
    const destination = { spreadsheetId: 'sheet-a', sheetName: 'Orders', credentialRef: 'connection-a', requiredHeaders: [] };
    const prisma = {
      googleSheetsDestination: {
        findUnique: vi.fn().mockResolvedValue(destination),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const fullHeader = [
      'order_id', 'created_at', 'status', 'channel', 'conversation_id', 'customer_name', 'customer_phone',
      'sku', 'product_name', 'quantity', 'delivery_city', 'delivery_branch', 'manager_note', 'confidence', 'updated_at',
    ];
    const sheets = {
      readHeader: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(fullHeader),
      initializeHeaderIfEmpty: vi.fn().mockResolvedValue(true),
    };
    const oauth = { verifySpreadsheet: vi.fn(), sheetsForConnection: vi.fn().mockResolvedValue(sheets) };
    const service = new GoogleSheetsSettingsService(prisma as never, undefined, { oauthRequired: true }, oauth);

    await expect(service.validate('tenant-a')).resolves.toMatchObject({ valid: true, status: 'ACTIVE', initialized: true });
    expect(sheets.initializeHeaderIfEmpty).toHaveBeenCalledWith({ spreadsheetId: 'sheet-a', sheetName: 'Orders', headers: fullHeader });
  });
});
