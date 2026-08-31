import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createPrismaClient, type PrismaClient } from '@autosale/database';
import type { ObjectStorage } from '@autosale/integrations';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
];

class MemoryStorage implements ObjectStorage {
  readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();

  async put(input: { key: string; body: Uint8Array; contentType: string }): Promise<{ key: string; etag: string }> {
    this.objects.set(input.key, { body: input.body, contentType: input.contentType });
    return { key: input.key, etag: 'fixture-etag' };
  }

  async get(key: string): Promise<{ body: Uint8Array; contentType: string }> {
    const object = this.objects.get(key);
    if (!object) throw new Error('Fixture object not found');
    return object;
  }
}

describe('CatalogueImportService', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let storage: MemoryStorage;
  let service: CatalogueImportService;
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
    service = new CatalogueImportService(prisma, storage);
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
    expect(sourceStorage.objectKey).toMatch(new RegExp(`^catalogue/${tenantId}/[0-9a-f]{64}\\.csv$`));
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
