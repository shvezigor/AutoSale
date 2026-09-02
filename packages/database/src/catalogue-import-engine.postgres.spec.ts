import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient } from './client.js';
import { CatalogueImportLeaseLostError, importCatalogueTable } from './catalogue-import-engine.js';
import type { PrismaClient } from './generated/prisma/client.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const sourceId = '22222222-2222-4222-8222-222222222222';
const originalLeaseId = '33333333-3333-4333-8333-333333333333';
const replacementLeaseId = '44444444-4444-4444-8444-444444444444';
const productWriteLock = 6_280_031;
const mapping = [{ source: 'sku', target: 'sku' as const }, { source: 'name', target: 'name' as const }];

describe('catalogue import PostgreSQL lease fencing', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let prisma: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    const connectionString = container.getConnectionUri();
    pool = new pg.Pool({ connectionString });
    prisma = createPrismaClient(connectionString);
    await applyMigrations(pool);
    await pool.query(`
      CREATE FUNCTION wait_before_catalogue_product_write() RETURNS trigger AS $$
      BEGIN
        PERFORM pg_advisory_xact_lock(${productWriteLock});
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER wait_before_catalogue_product_write
      BEFORE INSERT OR UPDATE ON products
      FOR EACH ROW EXECUTE FUNCTION wait_before_catalogue_product_write();
    `);
  }, 60_000);

  beforeEach(async () => {
    await pool.query('DELETE FROM products');
    await pool.query('DELETE FROM catalogue_sources');
    await pool.query('DELETE FROM tenants');
    await pool.query('INSERT INTO tenants (id, key, name) VALUES ($1, $2, $3)', [tenantId, 'lease-fence', 'Lease fence']);
    await pool.query(`INSERT INTO catalogue_sources
      (id, tenant_id, type, display_name, status, sync_lease_id, sync_lease_expires_at, sync_version)
      VALUES ($1, $2, 'GOOGLE_SHEETS', 'Products', 'ACTIVE', $3, NOW() + INTERVAL '5 minutes', 7)`,
    [sourceId, tenantId, originalLeaseId]);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await pool?.end();
    await container?.stop();
  });

  it('keeps the source heartbeat renewable while the atomic product transaction is open', async () => {
    const blocker = await pool.connect();
    await blocker.query('SELECT pg_advisory_lock($1)', [productWriteLock]);
    const importing = runImport(prisma);
    try {
      await waitForBlockedProductWrite(pool);
      const heartbeat = await queryWithStatementTimeout(pool, `UPDATE catalogue_sources
        SET sync_lease_expires_at = NOW() + INTERVAL '5 minutes'
        WHERE id = $1 AND tenant_id = $2 AND sync_lease_id = $3 AND sync_version = 7
          AND sync_lease_expires_at > NOW()`, [sourceId, tenantId, originalLeaseId]);
      expect(heartbeat.rowCount).toBe(1);
    } finally {
      await blocker.query('SELECT pg_advisory_unlock($1)', [productWriteLock]);
      blocker.release();
      await importing.catch(() => undefined);
    }

    await expect(importing).resolves.toMatchObject({ validRows: 1, createdRows: 1 });
    await expect(pool.query('SELECT sku, name, source_id FROM products')).resolves.toMatchObject({
      rows: [{ sku: 'LUNA-1', name: 'Luna', source_id: sourceId }],
    });
  });

  it('rolls back every product write when a newer lease token supersedes the blocked importer', async () => {
    const blocker = await pool.connect();
    await blocker.query('SELECT pg_advisory_lock($1)', [productWriteLock]);
    const importing = runImport(prisma);
    try {
      await waitForBlockedProductWrite(pool);
      const takeover = await queryWithStatementTimeout(pool, `UPDATE catalogue_sources
        SET sync_lease_id = $1, sync_lease_expires_at = NOW() + INTERVAL '5 minutes', sync_version = 8
        WHERE id = $2 AND tenant_id = $3 AND sync_lease_id = $4 AND sync_version = 7`,
      [replacementLeaseId, sourceId, tenantId, originalLeaseId]);
      expect(takeover.rowCount).toBe(1);
    } finally {
      await blocker.query('SELECT pg_advisory_unlock($1)', [productWriteLock]);
      blocker.release();
      await importing.catch(() => undefined);
    }

    await expect(importing).rejects.toBeInstanceOf(CatalogueImportLeaseLostError);
    await expect(pool.query('SELECT sku FROM products')).resolves.toMatchObject({ rows: [] });
  });
});

function runImport(prisma: PrismaClient) {
  const importing = importCatalogueTable(prisma, {
    tenantId, sourceId, ownershipPolicy: 'FENCE_CROSS_SOURCE', mapping, transformSettings: null,
    headers: ['SKU', 'Name'], rows: [['LUNA-1', 'Luna']],
    lease: { id: originalLeaseId, syncVersion: 7, ttlMs: 300_000 },
  });
  void importing.catch(() => undefined);
  return importing;
}

async function waitForBlockedProductWrite(pool: pg.Pool): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await pool.query<{ waiting: number }>(`SELECT COUNT(*)::int AS waiting FROM pg_locks
      WHERE locktype = 'advisory' AND granted = false`);
    if (result.rows[0]?.waiting === 1) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Catalogue import never reached the blocked product write');
}

async function queryWithStatementTimeout(pool: pg.Pool, text: string, values: unknown[]) {
  const client = await pool.connect();
  try {
    await client.query("SET statement_timeout = '1000ms'");
    return await client.query(text, values);
  } finally {
    client.release();
  }
}

async function applyMigrations(pool: pg.Pool): Promise<void> {
  const root = fileURLToPath(new URL('../prisma/migrations', import.meta.url));
  const migrations = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const migration of migrations) {
    await pool.query(await readFile(resolve(root, migration, 'migration.sql'), 'utf8'));
  }
}
