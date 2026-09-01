import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createPrismaClient, type PrismaClient } from '@autosale/database';
import type { ObjectStorage } from '@autosale/integrations';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { CatalogueMappingProcessor } from './catalogue-mapping.processor.js';

const preLeaseMigrations = [
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
const migrationRoot = resolve(process.cwd(), '../../packages/database/prisma/migrations');
const tenantId = '11111111-1111-4111-8111-111111111111';
const sourceId = '22222222-2222-4222-8222-222222222222';
const mappingId = '33333333-3333-4333-8333-333333333333';
const runId = '44444444-4444-4444-8444-444444444444';

describe('catalogue mapping lease migration', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    const connectionString = container.getConnectionUri();
    const pool = new pg.Pool({ connectionString });
    for (const migrationName of preLeaseMigrations) {
      await pool.query(await readFile(resolve(migrationRoot, migrationName, 'migration.sql'), 'utf8'));
    }
    await pool.query('INSERT INTO "tenants" ("id", "key", "name") VALUES ($1, $2, $3)', [tenantId, 'lease-migration', 'Lease migration']);
    await pool.query('INSERT INTO "catalogue_sources" ("id", "tenant_id", "type", "display_name", "status", "header_fingerprint") VALUES ($1, $2, $3, $4, $5, $6)', [sourceId, tenantId, 'CSV_UPLOAD', 'Legacy source', 'ACTIVE', 'legacy-fingerprint']);
    await pool.query('INSERT INTO "catalogue_mappings" ("id", "tenant_id", "source_id", "version", "source_fingerprint", "columns") VALUES ($1, $2, $3, $4, $5, $6::jsonb)', [mappingId, tenantId, sourceId, 1, 'legacy-fingerprint', '[]']);
    await pool.query('INSERT INTO "catalogue_import_runs" ("id", "tenant_id", "source_id", "mapping_id", "status", "idempotency_key") VALUES ($1, $2, $3, $4, $5, $6)', [runId, tenantId, sourceId, mappingId, 'MAPPING', 'legacy-mapping-run']);
    await pool.query(await readFile(resolve(migrationRoot, '20260901090000_catalogue_mapping_leases', 'migration.sql'), 'utf8'));
    await pool.end();
    prisma = createPrismaClient(connectionString);
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it('fences a pre-lease mapping run into manual review so a new claimant cannot process it', async () => {
    const migrated = await prisma.catalogueImportRun.findUniqueOrThrow({ where: { id: runId } });
    expect(migrated).toMatchObject({
      status: 'MAPPING_REVIEW', mappingId: null, mappingLeaseId: null, mappingLeaseExpiresAt: null,
      rowErrors: [{ errors: ['MAPPING_UPGRADE_RECOVERY'] }],
    });

    const mapper = { suggest: vi.fn() };
    const result = await new CatalogueMappingProcessor(prisma, {} as ObjectStorage, mapper).process({ tenantId, runId });
    expect(result).toEqual({ status: 'SKIPPED', proposal: null });
    expect(mapper.suggest).not.toHaveBeenCalled();
  });
});
