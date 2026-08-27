import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GoogleSheetsSettingsController } from './google-sheets-settings.controller.js';
import { GoogleSheetsSettingsService } from './google-sheets-settings.service.js';

describe('GoogleSheetsSettingsController', () => {
  let app: INestApplication;
  const get = vi.fn(); const update = vi.fn(); const validate = vi.fn();

  beforeEach(async () => {
    get.mockReset().mockResolvedValue({ spreadsheetId: null, sheetName: 'Orders', status: 'NOT_CONFIGURED', requiredHeaders: ['order_id', 'status'] });
    update.mockReset().mockResolvedValue({ spreadsheetId: 'abc123', sheetName: 'Продажі', status: 'PENDING', requiredHeaders: ['order_id', 'status'] });
    validate.mockReset().mockResolvedValue({ valid: true, missingHeaders: [], status: 'ACTIVE' });
    const moduleRef = await Test.createTestingModule({ controllers: [GoogleSheetsSettingsController], providers: [{ provide: GoogleSheetsSettingsService, useValue: { get, update, validate } }] }).compile();
    app = moduleRef.createNestApplication(); await app.init();
  });

  afterEach(async () => app.close());

  it('stores a spreadsheet id and tab without accepting credentials', async () => {
    await request(app.getHttpServer()).patch('/api/settings/google-sheets').send({ spreadsheetId: 'abc123', sheetName: 'Продажі' }).expect(200);
    expect(update).toHaveBeenCalledWith({ spreadsheetId: 'abc123', sheetName: 'Продажі' });
  });

  it('validates the configured destination', async () => {
    await request(app.getHttpServer()).post('/api/settings/google-sheets/validate').expect(201, { valid: true, missingHeaders: [], status: 'ACTIVE' });
  });

  it('rejects an empty spreadsheet id', async () => {
    await request(app.getHttpServer()).patch('/api/settings/google-sheets').send({ spreadsheetId: '', sheetName: 'Orders' }).expect(400);
    expect(update).not.toHaveBeenCalled();
  });
});
