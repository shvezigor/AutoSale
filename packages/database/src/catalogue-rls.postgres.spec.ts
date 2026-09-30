import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from './client.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { configureRuntimeDatabaseRoles } from './runtime-database-roles.js';
import { withTenantTransaction } from './tenant-transaction.js';

const apiPassword = 'fictional-api-password-32-characters';
const workerPassword = 'fictional-worker-password-32-chars';
const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const sourceA = '33333333-3333-4333-8333-333333333333';
const sourceB = '44444444-4444-4444-8444-444444444444';
const runA = '55555555-5555-4555-8555-555555555555';
const runB = '66666666-6666-4666-8666-666666666666';

describe('catalogue row-level security', () => {
  let container: StartedPostgreSqlContainer;
  let admin: pg.Pool;
  let api: PrismaClient;
  let worker: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    admin = new pg.Pool({ connectionString: container.getConnectionUri() });
    await applyMigrations(admin);
    await seedCatalogue(admin, tenantA, sourceA, runA, 'tenant-a');
    await seedCatalogue(admin, tenantB, sourceB, runB, 'tenant-b');
    await configureRuntimeDatabaseRoles(container.getConnectionUri(), { apiPassword, workerPassword });
    api = createPrismaClient(runtimeUrl(container.getConnectionUri(), 'autosale_api', apiPassword));
    worker = createPrismaClient(runtimeUrl(container.getConnectionUri(), 'autosale_worker', workerPassword));
  }, 60_000);

  afterAll(async () => {
    await api?.$disconnect();
    await worker?.$disconnect();
    await admin?.end();
    await container?.stop();
  });

  it('fails closed without tenant context and exposes only the selected tenant catalogue', async () => {
    for (const client of [api, worker]) {
      await expect(client.product.findMany()).resolves.toEqual([]);
      await expect(client.catalogueSource.findMany()).resolves.toEqual([]);
      await expect(client.catalogueMapping.findMany()).resolves.toEqual([]);
      await expect(client.catalogueImportRun.findMany()).resolves.toEqual([]);
    }

    await expect(withTenantTransaction(api, tenantA, async (transaction) => ({
      products: await transaction.product.count(),
      sources: await transaction.catalogueSource.count(),
      mappings: await transaction.catalogueMapping.count(),
      runs: await transaction.catalogueImportRun.count(),
    }))).resolves.toEqual({ products: 1, sources: 1, mappings: 1, runs: 1 });
  });

  it('rejects cross-tenant catalogue updates', async () => {
    await expect(withTenantTransaction(api, tenantA, (transaction) => transaction.product.update({
      where: { tenantId_sku: { tenantId: tenantB, sku: 'SKU-TENANT-B' } },
      data: { name: 'Forbidden' },
    }))).rejects.toMatchObject({ code: 'P2025' });
    await expect(withTenantTransaction(api, tenantA, (transaction) => transaction.catalogueSource.update({
      where: { id: sourceB },
      data: { displayName: 'Forbidden' },
    }))).rejects.toMatchObject({ code: 'P2025' });
  });

  it('allows only the worker role to discover bounded due source routing identifiers', async () => {
    const rows = await worker.$queryRaw<Array<{ tenant_id: string; source_id: string; sync_schedule: string }>>`
      SELECT tenant_id, source_id, sync_schedule
      FROM public.worker_due_catalogue_sources(${new Date('2099-01-01T00:00:00.000Z')}, ${null}::uuid, ${100})
      ORDER BY source_id
    `;
    expect(rows).toEqual([
      { tenant_id: tenantA, source_id: sourceA, sync_schedule: 'HOURLY' },
      { tenant_id: tenantB, source_id: sourceB, sync_schedule: 'HOURLY' },
    ]);
    await expect(api.$queryRaw`
      SELECT * FROM public.worker_due_catalogue_sources(${new Date('2099-01-01T00:00:00.000Z')}, ${null}::uuid, ${100})
    `).rejects.toMatchObject({ code: 'P2010' });
  });

  it('allows only the worker role to discover bounded mapping-run routing identifiers', async () => {
    const rows = await worker.$queryRaw<Array<{ tenant_id: string; run_id: string }>>`
      SELECT tenant_id, run_id
      FROM public.worker_due_catalogue_mapping_runs(${new Date('2026-09-30T12:00:00.000Z')}, ${100})
      ORDER BY run_id
    `;
    expect(rows).toEqual([
      { tenant_id: tenantA, run_id: runA },
      { tenant_id: tenantB, run_id: runB },
    ]);
    await expect(api.$queryRaw`
      SELECT * FROM public.worker_due_catalogue_mapping_runs(${new Date('2026-09-30T12:00:00.000Z')}, ${100})
    `).rejects.toMatchObject({ code: 'P2010' });
  });
});

async function seedCatalogue(pool: pg.Pool, tenantId: string, sourceId: string, runId: string, suffix: string): Promise<void> {
  const mappingId = crypto.randomUUID();
  await pool.query('INSERT INTO tenants (id, key, name) VALUES ($1, $2, $3)', [tenantId, suffix, `Fictional ${suffix}`]);
  await pool.query(`INSERT INTO catalogue_sources
    (id, tenant_id, type, display_name, status, sync_schedule, next_sync_at, updated_at)
    VALUES ($1, $2, 'GOOGLE_SHEETS', $3, 'ACTIVE', 'HOURLY', $4, NOW())`, [
    sourceId,
    tenantId,
    `Fictional ${suffix} source`,
    new Date('2026-09-30T11:00:00.000Z'),
  ]);
  await pool.query(`INSERT INTO catalogue_mappings
    (id, tenant_id, source_id, version, source_fingerprint, columns)
    VALUES ($1, $2, $3, 1, $4, '[]'::jsonb)`, [mappingId, tenantId, sourceId, `fingerprint-${suffix}`]);
  await pool.query(`INSERT INTO catalogue_import_runs
    (id, tenant_id, source_id, status, idempotency_key, updated_at)
    VALUES ($1, $2, $3, 'UPLOADED', $4, NOW())`, [runId, tenantId, sourceId, `run-${suffix}`]);
  await pool.query(`INSERT INTO products
    (id, tenant_id, sku, name, aliases, source_id, updated_at)
    VALUES ($1, $2, $3, $4, '[]'::jsonb, $5, NOW())`, [
    crypto.randomUUID(),
    tenantId,
    `SKU-${suffix.toUpperCase()}`,
    `Fictional ${suffix} product`,
    sourceId,
  ]);
}

function runtimeUrl(adminUrl: string, username: string, password: string): string {
  const url = new URL(adminUrl);
  url.username = username;
  url.password = password;
  return url.toString();
}

async function applyMigrations(pool: pg.Pool): Promise<void> {
  const root = resolve(fileURLToPath(new URL('../prisma/migrations', import.meta.url)));
  for (const name of (await readdir(root)).sort()) {
    if (name === 'migration_lock.toml') continue;
    await pool.query(await readFile(resolve(root, name, 'migration.sql'), 'utf8'));
  }
}
