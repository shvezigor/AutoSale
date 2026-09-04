import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createPrismaClient, Prisma, type PrismaClient } from '@autosale/database';
import type { ObjectStorage } from '@autosale/integrations';
import { ConflictException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CatalogueImportService } from './catalogue-import.service.js';

const ownerUserId = '11111111-1111-4111-8111-111111111111';
const otherOwnerUserId = '22222222-2222-4222-8222-222222222222';

const migrationNames = [
  '20260826090000_init_webhook_events',
  '20260826123000_conversations_messages',
  '20260826203000_ai_order_recognition',
  '20260826210000_product_catalog',
  '20260826213000_order_audit',
  '20260827070000_google_sheets_destination',
  '20260827110000_order_exports',
  '20260827110500_order_export_destination_fk',
  '20260827160000_self_hosted_auth',
  '20260827170000_tenant_access_status',
  '20260827230000_instagram_connections',
  '20260828_meta_instagram_oauth',
  '20260828150000_instagram_oauth_attempt_guard',
  '20260829120000_instagram_credential_cleanup_queue',
  '20260831090000_catalogue_import',
  '20260831091500_catalogue_tenant_relations',
  '20260831100000_catalogue_source_object_key',
  '20260901090000_catalogue_mapping_leases',
  '20260901120000_catalogue_sync_fencing',
];

class MemoryStorage implements ObjectStorage {
  readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();
  readonly deleted: string[] = [];
  getFailure: Error | null = null;

  async put(input: { key: string; body: Uint8Array; contentType: string }): Promise<{ key: string; etag: string }> {
    this.objects.set(input.key, { body: input.body, contentType: input.contentType });
    return { key: input.key, etag: 'fixture-etag' };
  }

  async get(key: string): Promise<{ body: Uint8Array; contentType: string }> {
    if (this.getFailure) throw this.getFailure;
    const object = this.objects.get(key);
    if (!object) throw new Error('Fixture object not found');
    return object;
  }

  async delete(key: string): Promise<void> {
    this.deleted.push(key);
    this.objects.delete(key);
  }
}

describe('CatalogueImportService', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let storage: MemoryStorage;
  let service: CatalogueImportService;
  let notifications: { create: ReturnType<typeof vi.fn> };
  let tenantId: string;
  let otherTenantId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    const connectionString = container.getConnectionUri();
    const pool = new pg.Pool({ connectionString });
    for (const migrationName of migrationNames) {
      const sql = await readFile(resolve(process.cwd(), `../../packages/database/prisma/migrations/${migrationName}/migration.sql`), 'utf8');
      await pool.query(sql);
    }
    await pool.end();
    prisma = createPrismaClient(connectionString);
    tenantId = (await prisma.tenant.create({ data: { key: 'catalogue-import-a', name: 'Import A' } })).id;
    otherTenantId = (await prisma.tenant.create({ data: { key: 'catalogue-import-b', name: 'Import B' } })).id;
  }, 60_000);

  beforeEach(async () => {
    await prisma.product.deleteMany();
    await prisma.catalogueImportRun.deleteMany();
    await prisma.catalogueMapping.deleteMany();
    await prisma.catalogueSource.deleteMany();
    storage = new MemoryStorage();
    notifications = { create: vi.fn().mockResolvedValue(undefined) };
    service = new CatalogueImportService(prisma, storage, undefined, notifications as never);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it('previews required fields, duplicate SKU row numbers, locale numbers, aliases, and partial counts without mutating products', async () => {
    await prisma.product.create({
      data: { tenantId, sku: 'LUNA-01', name: 'Old Luna', description: 'Keep me', aliases: [], imageUrls: [], attributes: {}, active: true },
    });
    const run = await uploadAndMap([
      'SKU,Name,Description,Price,Aliases',
      'LUNA-01,Luna Lamp,,"1 234,50","Moon; Night Light"',
      'SOL-02,Sol Chair,,89.95,Sun',
      ',Missing SKU,,12.00,',
      'BROKEN-03,,,not-a-number,',
    ].join('\n'));

    const sourceStorage = await prisma.catalogueSource.findUniqueOrThrow({
      where: { id: run.sourceId },
      select: { objectKey: true, credentialRef: true },
    });
    expect(sourceStorage.objectKey).toMatch(new RegExp(`^catalogue/${tenantId}/[0-9a-f]{64}/[0-9a-f-]{36}\\.csv$`));
    expect(sourceStorage.credentialRef).toBeNull();

    const preview = await service.preview(tenantId, run.id);

    expect(preview.rows).toEqual([
      { rowNumber: 2, product: { sku: 'LUNA-01', name: 'Luna Lamp', price: 1234.5, aliases: ['Moon', 'Night Light'], imageUrls: [], attributes: {}, active: true }, errors: [] },
      { rowNumber: 3, product: { sku: 'SOL-02', name: 'Sol Chair', price: 89.95, aliases: ['Sun'], imageUrls: [], attributes: {}, active: true }, errors: [] },
      { rowNumber: 4, errors: ['SKU is required'] },
      { rowNumber: 5, errors: ['Name is required', 'Price must be a non-negative number'] },
    ]);
    expect(preview.totals).toEqual({ created: 1, updated: 1, skipped: 0, failed: 2 });
    expect(await prisma.product.count({ where: { tenantId } })).toBe(1);

    const duplicateRun = await uploadAndMap([
      'SKU,Name,Description,Price,Aliases',
      'DUP-01,First,,1,',
      'OK-02,Middle,,2,',
      ' dup-01 ,Last,,3,',
    ].join('\n'));
    const duplicatePreview = await service.preview(tenantId, duplicateRun.id);
    expect(duplicatePreview.rows[0]?.errors[0]).toContain('row 4');
    expect(duplicatePreview.rows[2]?.errors[0]).toContain('row 2');
    expect(duplicatePreview.totals).toEqual({ created: 1, updated: 0, skipped: 0, failed: 2 });
  });

  it('confirms valid rows in batches, preserves empty existing values, and never deactivates missing products', async () => {
    await prisma.product.createMany({ data: [
      { tenantId, sku: 'LUNA-01', name: 'Old Luna', description: 'Keep me', aliases: [], imageUrls: [], attributes: {}, active: true },
      { tenantId, sku: 'LEGACY-01', name: 'Legacy', aliases: [], imageUrls: [], attributes: {}, active: true },
      { tenantId: otherTenantId, sku: 'SOL-02', name: 'Foreign Sol', aliases: [], imageUrls: [], attributes: {}, active: true },
    ] });
    const run = await uploadAndMap([
      'SKU,Name,Description,Price,Aliases',
      'LUNA-01,Luna Lamp,,"1 234,50","Moon; Night Light"',
      'SOL-02,Sol Chair,,89.95,Sun',
      ',Missing SKU,,12.00,',
      'BROKEN-03,,,not-a-number,',
    ].join('\n'));

    const first = await service.confirm(tenantId, ownerUserId, run.id);
    const second = await service.confirm(tenantId, ownerUserId, run.id);

    expect(first).toEqual(second);
    expect(first).toMatchObject({ status: 'COMPLETED', totalRows: 4, validRows: 2, createdRows: 1, updatedRows: 1, skippedRows: 0, failedRows: 2 });
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({
      tenantId, userId: ownerUserId, type: 'SUCCESS', category: 'CATALOGUE_IMPORT_COMPLETED', actionUrl: '/catalogue',
    }));
    const luna = await prisma.product.findUniqueOrThrow({ where: { tenantId_sku: { tenantId, sku: 'LUNA-01' } }, select: { name: true, description: true, price: true, aliases: true, active: true } });
    expect({ ...luna, price: Number(luna.price) }).toEqual({ name: 'Luna Lamp', description: 'Keep me', price: 1234.5, aliases: ['Moon', 'Night Light'], active: true });
    expect(await prisma.product.findUniqueOrThrow({ where: { tenantId_sku: { tenantId, sku: 'LEGACY-01' } }, select: { active: true } })).toEqual({ active: true });
    expect(await prisma.product.findUniqueOrThrow({ where: { tenantId_sku: { tenantId, sku: 'SOL-02' } }, select: { name: true } })).toEqual({ name: 'Sol Chair' });
    expect(await prisma.product.findUniqueOrThrow({ where: { tenantId_sku: { tenantId: otherTenantId, sku: 'SOL-02' } }, select: { name: true } })).toEqual({ name: 'Foreign Sol' });

    const persistedRun = await prisma.catalogueImportRun.findUniqueOrThrow({ where: { id: run.id }, select: { rowErrors: true } });
    expect(JSON.stringify(persistedRun.rowErrors)).not.toContain('Missing SKU');
    expect(persistedRun.rowErrors).toEqual([
      { rowNumber: 4, errors: ['SKU_REQUIRED'] },
      { rowNumber: 5, errors: ['NAME_REQUIRED', 'PRICE_INVALID'] },
    ]);
  });

  it('re-imports a changed file from a new upload source and updates the existing tenant SKU name', async () => {
    const first = await uploadAndMap('SKU,Name,Description,Price,Aliases\nTASK7-01,Original Task 7 name,,,');
    await service.confirm(tenantId, ownerUserId, first.id);
    const second = await uploadAndMap('SKU,Name,Description,Price,Aliases\nTASK7-01,Changed Task 7 name,,,');

    await expect(service.confirm(tenantId, ownerUserId, second.id)).resolves.toMatchObject({ status: 'COMPLETED', updatedRows: 1 });
    await expect(prisma.product.findUniqueOrThrow({
      where: { tenantId_sku: { tenantId, sku: 'TASK7-01' } }, select: { name: true, sourceId: true },
    })).resolves.toEqual({ name: 'Changed Task 7 name', sourceId: second.sourceId });
  });

  it('never reads a run or mapping through a different tenant', async () => {
    const run = await uploadAndMap('SKU,Name,Description,Price,Aliases\nLUNA-01,Luna,,,');

    await expect(service.preview(otherTenantId, run.id)).rejects.toThrow();
    await expect(service.confirm(otherTenantId, otherOwnerUserId, run.id)).rejects.toThrow();
    expect(await prisma.product.count({ where: { tenantId: otherTenantId } })).toBe(0);
  });

  it('bounds the persisted privacy-safe error report without losing aggregate failure counts', async () => {
    const invalidRows = Array.from({ length: 101 }, (_, index) => `,Missing SKU ${index + 1},,,`);
    const run = await uploadAndMap(['SKU,Name,Description,Price,Aliases', ...invalidRows].join('\n'));

    const result = await service.confirm(tenantId, ownerUserId, run.id);
    const persisted = await prisma.catalogueImportRun.findUniqueOrThrow({ where: { id: run.id }, select: { rowErrors: true } });

    expect(result).toMatchObject({ totalRows: 101, validRows: 0, failedRows: 101 });
    expect(persisted.rowErrors).toHaveLength(100);
  });

  it('clears only mapped empty fields that the owner explicitly enabled', async () => {
    await prisma.product.create({
      data: { tenantId, sku: 'LUNA-01', name: 'Luna', description: 'Remove me', aliases: ['Old alias'], imageUrls: [], attributes: {}, active: true },
    });
    const uploaded = await service.upload(tenantId, ownerUserId, {
      originalName: 'clear.csv', mediaType: 'text/csv', buffer: Buffer.from('SKU,Name,Description,Aliases\nLUNA-01,Luna,,""'),
    });
    await service.updateMapping(tenantId, ownerUserId, uploaded.id, {
      columns: [
        { source: 'sku', target: 'sku' }, { source: 'name', target: 'name' },
        { source: 'description', target: 'description' }, { source: 'aliases', target: 'aliases' },
      ],
      clearEmptyFields: ['description', 'aliases'],
    });

    const previewWithClears = await service.preview(tenantId, uploaded.id);
    await service.confirm(tenantId, ownerUserId, uploaded.id);
    const product = await prisma.product.findUniqueOrThrow({ where: { tenantId_sku: { tenantId, sku: 'LUNA-01' } }, select: { description: true, aliases: true } });

    expect(previewWithClears.rows[0]?.product).toMatchObject({ description: null, aliases: [] });
    expect(product).toEqual({ description: null, aliases: [] });
  });

  it('rejects remapping a processing run with a safe 409 and does not create an orphan mapping', async () => {
    const uploaded = await service.upload(tenantId, ownerUserId, {
      originalName: 'products.csv',
      mediaType: 'text/csv',
      buffer: Buffer.from('SKU,Name\nLUNA-01,Luna'),
    });
    await prisma.catalogueImportRun.update({
      where: { id: uploaded.id },
      data: { status: 'PROCESSING' },
    });

    await expect(service.updateMapping(tenantId, ownerUserId, uploaded.id, {
      columns: [
        { source: 'sku', target: 'sku' },
        { source: 'name', target: 'name' },
      ],
    })).rejects.toMatchObject({
      constructor: ConflictException,
      message: 'Catalogue import cannot be remapped',
    });

    expect(await prisma.catalogueMapping.count()).toBe(0);
  });

  it('rejects a concurrent remap lock loss with a safe 409 and leaves no orphan mapping', async () => {
    const uploaded = await service.upload(tenantId, ownerUserId, {
      originalName: 'products.csv',
      mediaType: 'text/csv',
      buffer: Buffer.from('SKU,Name\nLUNA-01,Luna'),
    });
    const prismaWithLostLock = createPrismaWithLostRemapLock(prisma);
    const lockedService = new CatalogueImportService(prismaWithLostLock, storage);

    await expect(lockedService.updateMapping(tenantId, ownerUserId, uploaded.id, {
      columns: [
        { source: 'sku', target: 'sku' },
        { source: 'name', target: 'name' },
      ],
    })).rejects.toMatchObject({
      constructor: ConflictException,
      message: 'Catalogue import cannot be remapped',
    });

    expect(await prisma.catalogueMapping.count()).toBe(0);
    expect(await prisma.catalogueImportRun.findUniqueOrThrow({
      where: { id: uploaded.id },
      select: { status: true, mappingId: true },
    })).toEqual({ status: 'UPLOADED', mappingId: null });
  });

  it('deletes the stored object when upload persistence fails after storage put', async () => {
    const failingPrisma = createPrismaWithFailingUploadTransaction(prisma);
    const failingService = new CatalogueImportService(failingPrisma, storage);

    await expect(failingService.upload(tenantId, ownerUserId, {
      originalName: 'products.csv',
      mediaType: 'text/csv',
      buffer: Buffer.from('SKU,Name\nLUNA-01,Luna'),
    })).rejects.toThrow('Catalogue import is temporarily unavailable');

    expect(storage.deleted).toHaveLength(1);
    expect(storage.objects.size).toBe(0);
    expect(await prisma.catalogueSource.count()).toBe(0);
    expect(await prisma.catalogueImportRun.count()).toBe(0);
  });

  it('returns a safe 503 when stored source retrieval fails', async () => {
    const uploaded = await uploadAndMap('SKU,Name,Description,Price,Aliases\nLUNA-01,Luna,,,');
    storage.getFailure = new Error('socket timeout secret-key-123');

    await expect(service.preview(tenantId, uploaded.id)).rejects.toMatchObject({
      constructor: ServiceUnavailableException,
      message: 'Catalogue source file is temporarily unavailable',
    });
  });

  it('returns a safe 422 when a stored source body can no longer be parsed', async () => {
    const uploaded = await uploadAndMap('SKU,Name,Description,Price,Aliases\nLUNA-01,Luna,,,');
    const source = await prisma.catalogueSource.findUniqueOrThrow({
      where: { id: uploaded.sourceId },
      select: { objectKey: true },
    });
    storage.objects.set(source.objectKey!, {
      body: Buffer.from('not-a-catalogue-source'),
      contentType: 'application/json',
    });

    await expect(service.preview(tenantId, uploaded.id)).rejects.toMatchObject({
      constructor: UnprocessableEntityException,
      message: 'Stored catalogue source is unreadable',
    });
  });

  it('returns the durable run and preserves the winner object when a duplicate upload loses the idempotency race', async () => {
    const file = {
      originalName: 'products.csv',
      mediaType: 'text/csv',
      buffer: Buffer.from('SKU,Name\nLUNA-01,Luna'),
    };
    const racingPrisma = createPrismaWithDuplicateUploadRace(prisma);
    const firstService = new CatalogueImportService(racingPrisma, storage);
    const secondService = new CatalogueImportService(racingPrisma, storage);

    const [first, second] = await Promise.all([
      firstService.upload(tenantId, ownerUserId, file),
      secondService.upload(tenantId, ownerUserId, file),
    ]);
    const winner = first.id === second.id ? first : second;
    const loser = first.id === winner.id ? second : first;
    const winnerSource = await prisma.catalogueSource.findUniqueOrThrow({
      where: { id: winner.sourceId },
      select: { objectKey: true },
    });

    expect(loser).toEqual(winner);
    expect(storage.deleted).toHaveLength(1);
    expect(storage.deleted[0]).not.toBe(winnerSource.objectKey);
    expect(storage.deleted[0]).toMatch(new RegExp(`^catalogue/${tenantId}/[0-9a-f]{64}/[0-9a-f-]{36}\\.csv$`));
    expect(storage.objects.has(winnerSource.objectKey!)).toBe(true);
    expect(storage.deleted).not.toContain(winnerSource.objectKey!);
    expect(storage.objects.size).toBe(1);
    expect(await prisma.catalogueSource.count()).toBe(1);
    expect(await prisma.catalogueImportRun.count()).toBe(1);
  });

  it('enqueues a mapping job only after a new upload run is durable', async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const queuedService = new CatalogueImportService(prisma, storage, { add });
    const file = { originalName: 'products.csv', mediaType: 'text/csv', buffer: Buffer.from('SKU,Name\nLUNA-01,Luna') };

    const first = await queuedService.upload(tenantId, ownerUserId, file);
    const second = await queuedService.upload(tenantId, ownerUserId, file);

    expect(second.id).toBe(first.id);
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith('catalogue.mapping', { tenantId, runId: first.id }, expect.objectContaining({ jobId: `catalogue.mapping:${first.id}` }));
    expect(await prisma.catalogueImportRun.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ tenantId, status: 'UPLOADED' });
  });

  it('keeps a durable uploaded dispatch record when the immediate queue enqueue fails', async () => {
    const queuedService = new CatalogueImportService(prisma, storage, { add: vi.fn().mockRejectedValue(new Error('redis unavailable')) });

    const uploaded = await queuedService.upload(tenantId, ownerUserId, {
      originalName: 'products.csv', mediaType: 'text/csv', buffer: Buffer.from('SKU,Name\nLUNA-01,Luna'),
    });

    expect(await prisma.catalogueImportRun.findUniqueOrThrow({ where: { id: uploaded.id }, select: { status: true, mappingId: true } }))
      .toEqual({ status: 'UPLOADED', mappingId: null });
  });

  it('lets an owner review, preview, and confirm a server-side Google snapshot without exposing rows in status', async () => {
    const source = await prisma.catalogueSource.create({ data: {
      tenantId, type: 'GOOGLE_SHEETS', displayName: 'Google catalogue', status: 'PAUSED',
      spreadsheetId: 'private-sheet-id', sheetName: 'Products', syncSchedule: 'MANUAL',
    } });
    const snapshotObjectKey = `catalogue/${tenantId}/${source.id}/google/revision-1.json`;
    await storage.put({
      key: snapshotObjectKey,
      contentType: 'application/vnd.autosale.catalogue-table+json',
      body: Buffer.from(JSON.stringify({ headers: ['sku', 'name', 'price'], rows: [['LUNA-1', 'Private Luna', '12,50']], fingerprint: 'google-fingerprint' })),
    });
    const run = await prisma.catalogueImportRun.create({ data: {
      tenantId, sourceId: source.id, status: 'MAPPING_REVIEW', idempotencyKey: `google:${source.id}:revision-1:review`,
      sourceRevision: 'revision-1', sourceHeaders: ['sku', 'name', 'price'], snapshotObjectKey, sourceSyncVersion: source.syncVersion, totalRows: 1,
    } });

    const status = await service.status(tenantId, run.id);
    expect(status).toMatchObject({ id: run.id, status: 'MAPPING_REVIEW', headers: ['sku', 'name', 'price'] });
    expect(JSON.stringify(status)).not.toContain('Private Luna');

    const preview = await service.updateMapping(tenantId, ownerUserId, run.id, { columns: [
      { source: 'sku', target: 'sku' }, { source: 'name', target: 'name' }, { source: 'price', target: 'price' },
    ] });
    expect(preview.rows[0]?.product).toMatchObject({ sku: 'LUNA-1', name: 'Private Luna', price: 12.5 });
    await expect(service.confirm(tenantId, ownerUserId, run.id)).resolves.toMatchObject({ status: 'COMPLETED', createdRows: 1 });
    await expect(prisma.product.findUnique({ where: { tenantId_sku: { tenantId, sku: 'LUNA-1' } } })).resolves.toMatchObject({ sourceId: source.id });
  });

  it('previews and imports a Google catalogue without an SKU column using a stable generated SKU', async () => {
    const source = await prisma.catalogueSource.create({ data: {
      tenantId, type: 'GOOGLE_SHEETS', displayName: 'Google without SKU', status: 'PAUSED',
      spreadsheetId: 'private-sheet-id', sheetName: 'Products', syncSchedule: 'MANUAL',
    } });
    const snapshotObjectKey = `catalogue/${tenantId}/${source.id}/google/no-sku.json`;
    await storage.put({
      key: snapshotObjectKey, contentType: 'application/vnd.autosale.catalogue-table+json',
      body: Buffer.from(JSON.stringify({ headers: ['name', 'price'], rows: [['Private Luna', '12,50']] })),
    });
    const run = await prisma.catalogueImportRun.create({ data: {
      tenantId, sourceId: source.id, status: 'MAPPING_REVIEW', idempotencyKey: `google:${source.id}:no-sku:review`,
      sourceRevision: 'no-sku', sourceHeaders: ['name', 'price'], snapshotObjectKey, sourceSyncVersion: source.syncVersion, totalRows: 1,
    } });

    const preview = await service.updateMapping(tenantId, ownerUserId, run.id, { columns: [
      { source: 'name', target: 'name' }, { source: 'price', target: 'price' },
    ] });
    const generatedSku = preview.rows[0]?.product?.sku;
    expect(generatedSku).toMatch(/^AUTO-[A-F0-9]{12}$/);
    await expect(service.confirm(tenantId, ownerUserId, run.id)).resolves.toMatchObject({ status: 'COMPLETED', createdRows: 1 });
    await expect(prisma.product.findUnique({ where: { tenantId_sku: { tenantId, sku: generatedSku! } } })).resolves.toMatchObject({ name: 'Private Luna', sourceId: source.id });
  });

  it('does not import or activate a Google snapshot after the source configuration version changes', async () => {
    const source = await prisma.catalogueSource.create({ data: {
      tenantId, type: 'GOOGLE_SHEETS', displayName: 'Stale Google catalogue', status: 'PAUSED',
      spreadsheetId: 'private-sheet-id', sheetName: 'Products', syncSchedule: 'MANUAL', syncVersion: 4,
    } });
    const snapshotObjectKey = `catalogue/${tenantId}/${source.id}/google/stale-revision.json`;
    await storage.put({
      key: snapshotObjectKey,
      contentType: 'application/vnd.autosale.catalogue-table+json',
      body: Buffer.from(JSON.stringify({ headers: ['sku', 'name'], rows: [['STALE-1', 'Must not import']] })),
    });
    const run = await prisma.catalogueImportRun.create({ data: {
      tenantId, sourceId: source.id, status: 'MAPPING_REVIEW', idempotencyKey: `google:${source.id}:stale-revision:review`,
      sourceRevision: 'stale-revision', sourceHeaders: ['sku', 'name'], snapshotObjectKey, sourceSyncVersion: 4, totalRows: 1,
    } });
    await service.updateMapping(tenantId, ownerUserId, run.id, { columns: [
      { source: 'sku', target: 'sku' }, { source: 'name', target: 'name' },
    ] });
    await prisma.catalogueSource.update({ where: { id: source.id }, data: { syncVersion: { increment: 1 }, status: 'PENDING' } });

    await expect(service.confirm(tenantId, ownerUserId, run.id)).rejects.toMatchObject({
      constructor: ConflictException, message: 'Catalogue source changed after this preview',
    });
    expect(await prisma.product.count({ where: { tenantId, sku: 'STALE-1' } })).toBe(0);
    expect(await prisma.catalogueImportRun.findUniqueOrThrow({ where: { id: run.id }, select: { status: true } })).toEqual({ status: 'PREVIEW_READY' });
    expect(await prisma.catalogueSource.findUniqueOrThrow({ where: { id: source.id }, select: { status: true } })).toEqual({ status: 'PENDING' });
  });

  async function uploadAndMap(csv: string) {
    const uploaded = await service.upload(tenantId, ownerUserId, {
      originalName: 'products.csv',
      mediaType: 'text/csv',
      buffer: Buffer.from(csv),
    });
    await service.updateMapping(tenantId, ownerUserId, uploaded.id, {
      columns: [
        { source: 'sku', target: 'sku' },
        { source: 'name', target: 'name' },
        { source: 'description', target: 'description' },
        { source: 'price', target: 'price' },
        { source: 'aliases', target: 'aliases' },
      ],
    });
    return uploaded;
  }
});

function createPrismaWithLostRemapLock(prisma: PrismaClient): PrismaClient {
  return new Proxy(prisma, {
    get(target, property, receiver) {
      if (property === '$transaction') {
        return async (arg: unknown) => {
          if (typeof arg === 'function') {
            return prisma.$transaction((tx) => arg(createTxWithLostRemapLock(tx)));
          }
          return prisma.$transaction(arg as Parameters<PrismaClient['$transaction']>[0]);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  }) as PrismaClient;
}

function createPrismaWithFailingUploadTransaction(prisma: PrismaClient): PrismaClient {
  return new Proxy(prisma, {
    get(target, property, receiver) {
      if (property === '$transaction') {
        return async (arg: unknown) => {
          if (typeof arg === 'function') {
            return prisma.$transaction(async (tx) => {
              await arg(tx);
              throw new Error('simulated upload transaction failure');
            });
          }
          return prisma.$transaction(arg as Parameters<PrismaClient['$transaction']>[0]);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  }) as PrismaClient;
}

function createPrismaWithDuplicateUploadRace(prisma: PrismaClient): PrismaClient {
  let precheckCount = 0;
  let releasePrechecks!: () => void;
  const prechecksReleased = new Promise<void>((resolve) => {
    releasePrechecks = resolve;
  });

  const runDelegate = new Proxy(prisma.catalogueImportRun, {
    get(target, property, receiver) {
      if (property === 'findUnique') {
        return async (args: { where?: { tenantId_idempotencyKey?: { tenantId: string; idempotencyKey: string } } }) => {
          if (args.where?.tenantId_idempotencyKey && precheckCount < 2) {
            precheckCount += 1;
            if (precheckCount === 2) releasePrechecks();
            await prechecksReleased;
            return null;
          }
          return prisma.catalogueImportRun.findUnique(args as never);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });

  return new Proxy(prisma, {
    get(target, property, receiver) {
      if (property === 'catalogueImportRun') return runDelegate;
      return Reflect.get(target, property, receiver);
    },
  }) as PrismaClient;
}

function createTxWithLostRemapLock(tx: Prisma.TransactionClient): Prisma.TransactionClient {
  const runDelegate = new Proxy(tx.catalogueImportRun, {
    get(target, property, receiver) {
      if (property === 'updateMany') {
        return async (args: { data?: { mappingId?: string } }) => {
          if (args?.data && 'mappingId' in args.data) return { count: 0 };
          return tx.catalogueImportRun.updateMany(args as never);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });

  return new Proxy(tx, {
    get(target, property, receiver) {
      if (property === 'catalogueImportRun') return runDelegate;
      return Reflect.get(target, property, receiver);
    },
  }) as Prisma.TransactionClient;
}
