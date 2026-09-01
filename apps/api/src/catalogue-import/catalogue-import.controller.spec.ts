import { type INestApplication } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AuthGuard } from '../auth/auth.guard.js';
import { CatalogueImportController } from './catalogue-import.controller.js';
import { CatalogueImportService } from './catalogue-import.service.js';

const tenantId = '22222222-2222-4222-8222-222222222222';
const runId = '33333333-3333-4333-8333-333333333333';
const sourceId = '44444444-4444-4444-8444-444444444444';
const summary = {
  id: runId, sourceId, status: 'UPLOADED', totalRows: 2, validRows: 0,
  createdRows: 0, updatedRows: 0, skippedRows: 0, failedRows: 0,
  startedAt: null, completedAt: null, headers: ['sku', 'name'], fingerprint: 'fixture-fingerprint',
};
const preview = { rows: [], totals: { created: 0, updated: 0, skipped: 0, failed: 0 } };

class RecordingImportService {
  uploads: Array<{ tenantId: string; userId: string; originalName: string; mediaType: string; body: string }> = [];
  mappingCalls: unknown[][] = [];
  previewCalls: unknown[][] = [];
  confirmCalls: unknown[][] = [];
  statusCalls: unknown[][] = [];

  async upload(tenant: string, user: string, file: { originalName: string; mediaType: string; buffer: Buffer }) {
    this.uploads.push({ tenantId: tenant, userId: user, originalName: file.originalName, mediaType: file.mediaType, body: file.buffer.toString('utf8') });
    return summary;
  }

  async updateMapping(...args: unknown[]) { this.mappingCalls.push(args); return preview; }
  async preview(...args: unknown[]) { this.previewCalls.push(args); return preview; }
  async confirm(...args: unknown[]) { this.confirmCalls.push(args); return { ...summary, status: 'COMPLETED' }; }
  async status(...args: unknown[]) { this.statusCalls.push(args); return { ...summary, status: 'MAPPING_REVIEW', mapping: { columns: [{ source: 'sku', target: 'sku', confidence: 0.98 }], aiModel: 'gpt-5.4-mini', promptVersion: 'catalogue-column-mapping-v1' } }; }
}

describe('CatalogueImportController', () => {
  let app: INestApplication;
  let imports: RecordingImportService;

  beforeEach(async () => {
    imports = new RecordingImportService();
    const sessions = {
      resolve: async (token: string) => token === 'owner'
        ? { userId: 'owner-user', email: 'owner@example.com', platformRole: 'USER', tenantId, membershipRole: 'OWNER', sessionId: 'owner-session' }
        : token === 'manager'
          ? { userId: 'manager-user', email: 'manager@example.com', platformRole: 'USER', tenantId, membershipRole: 'MANAGER', sessionId: 'manager-session' }
          : null,
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [CatalogueImportController],
      providers: [
        { provide: CatalogueImportService, useValue: imports },
        { provide: APP_GUARD, useFactory: () => new AuthGuard(new Reflector(), sessions as never, { cookieName: 'session', production: false }, { verify: () => true } as never) },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => app?.close());

  it('accepts a bounded owner CSV upload and passes only server-received bytes and metadata', async () => {
    await request(app.getHttpServer())
      .post('/api/catalogue/imports/upload')
      .set('Cookie', 'session=owner')
      .set('x-csrf-token', 'csrf')
      .attach('file', Buffer.from('SKU,Name\nLUNA-01,Luna'), { filename: 'products.csv', contentType: 'text/csv' })
      .expect(201, summary);

    expect(imports.uploads).toEqual([{ tenantId, userId: 'owner-user', originalName: 'products.csv', mediaType: 'text/csv', body: 'SKU,Name\nLUNA-01,Luna' }]);
  });

  it('rejects mismatched extensions, unsupported media, and over-limit uploads before service execution', async () => {
    await request(app.getHttpServer()).post('/api/catalogue/imports/upload').set('Cookie', 'session=owner').set('x-csrf-token', 'csrf')
      .attach('file', Buffer.from('SKU,Name\nA-1,Alpha'), { filename: 'products.xlsx', contentType: 'text/csv' }).expect(400);
    await request(app.getHttpServer()).post('/api/catalogue/imports/upload').set('Cookie', 'session=owner').set('x-csrf-token', 'csrf')
      .attach('file', Buffer.from('{}'), { filename: 'products.json', contentType: 'application/json' }).expect(400);
    await request(app.getHttpServer()).post('/api/catalogue/imports/upload').set('Cookie', 'session=owner').set('x-csrf-token', 'csrf')
      .attach('file', Buffer.alloc(5 * 1024 * 1024 + 1), { filename: 'large.csv', contentType: 'text/csv' }).expect(413);

    expect(imports.uploads).toEqual([]);
  });

  it('exposes mapping, preview, and confirmation only to an owner with CSRF on mutations', async () => {
    const mapping = { columns: [{ source: 'sku', target: 'sku' }, { source: 'name', target: 'name' }] };
    await request(app.getHttpServer()).patch(`/api/catalogue/imports/${runId}/mapping`).set('Cookie', 'session=owner').set('x-csrf-token', 'csrf').send(mapping).expect(200, preview);
    await request(app.getHttpServer()).get(`/api/catalogue/imports/${runId}/preview`).set('Cookie', 'session=owner').expect(200, preview);
    await request(app.getHttpServer()).post(`/api/catalogue/imports/${runId}/confirm`).set('Cookie', 'session=owner').set('x-csrf-token', 'csrf').expect(201);

    expect(imports.mappingCalls).toEqual([[tenantId, 'owner-user', runId, mapping]]);
    expect(imports.previewCalls).toEqual([[tenantId, runId]]);
    expect(imports.confirmCalls).toEqual([[tenantId, 'owner-user', runId]]);

    await request(app.getHttpServer()).get(`/api/catalogue/imports/${runId}/preview`).set('Cookie', 'session=manager').expect(403);
    await request(app.getHttpServer()).post(`/api/catalogue/imports/${runId}/confirm`).set('Cookie', 'session=owner').expect(403);
    expect(imports.confirmCalls).toHaveLength(1);
  });

  it('returns only the owner-visible import status and draft mapping, never source data', async () => {
    const response = await request(app.getHttpServer()).get(`/api/catalogue/imports/${runId}`).set('Cookie', 'session=owner').expect(200);

    expect(response.body).toMatchObject({ id: runId, status: 'MAPPING_REVIEW', mapping: { columns: [{ source: 'sku', target: 'sku', confidence: 0.98 }] } });
    expect(imports.statusCalls).toEqual([[tenantId, runId]]);
    await request(app.getHttpServer()).get(`/api/catalogue/imports/${runId}`).set('Cookie', 'session=manager').expect(403);
  });
});
