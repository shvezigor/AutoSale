import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
const migrationRoot = resolve(process.cwd(), '../../packages/database/prisma/migrations');

describe('catalogue sync schedule successor migration', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    for (const migrationName of migrationNames) {
      await pool.query(await readFile(resolve(migrationRoot, migrationName, 'migration.sql'), 'utf8'));
    }
    await pool.query(`INSERT INTO "tenants" ("id", "key", "name") VALUES
      ('11111111-1111-4111-8111-111111111111', 'schedule-migration', 'Schedule migration')`);
    await pool.query(`INSERT INTO "catalogue_sources"
      ("id", "tenant_id", "type", "display_name", "status", "sync_schedule", "next_sync_at") VALUES
      ('21111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'GOOGLE_SHEETS', 'Hourly', 'ACTIVE', 'HOURLY', NULL),
      ('31111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'GOOGLE_SHEETS', 'Daily', 'ACTIVE', 'DAILY', NULL),
      ('41111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'GOOGLE_SHEETS', 'Manual', 'ACTIVE', 'MANUAL', NULL),
      ('51111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'GOOGLE_SHEETS', 'Paused', 'PAUSED', 'HOURLY', NULL)`);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('backfills due times only for existing active hourly and daily Google sources', async () => {
    await pool.query(await readFile(resolve(migrationRoot, '20260901130000_catalogue_sync_schedule_backfill', 'migration.sql'), 'utf8'));
    const result = await pool.query<{ display_name: string; next_sync_at: Date | null }>(
      'SELECT "display_name", "next_sync_at" FROM "catalogue_sources" ORDER BY "display_name"',
    );

    expect(Object.fromEntries(result.rows.map((row) => [row.display_name, row.next_sync_at]))).toMatchObject({
      Hourly: expect.any(Date), Daily: expect.any(Date), Manual: null, Paused: null,
    });
  });
});
