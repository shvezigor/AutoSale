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
const userA = '33333333-3333-4333-8333-333333333333';
const userB = '44444444-4444-4444-8444-444444444444';
const attemptA = '55555555-5555-4555-8555-555555555555';
const cleanupA = '66666666-6666-4666-8666-666666666666';
const cleanupB = '77777777-7777-4777-8777-777777777777';

describe('Google integration state row-level security', () => {
  let container: StartedPostgreSqlContainer;
  let admin: pg.Pool;
  let api: PrismaClient;
  let worker: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    admin = new pg.Pool({ connectionString: container.getConnectionUri() });
    await applyMigrations(admin);
    await seedTenantIntegration(admin, tenantA, userA, 'tenant-a', attemptA, cleanupA);
    await seedTenantIntegration(
      admin,
      tenantB,
      userB,
      'tenant-b',
      '88888888-8888-4888-8888-888888888888',
      cleanupB,
    );
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

  it('fails closed without tenant context and exposes only the selected tenant', async () => {
    for (const client of [api, worker]) {
      await expect(client.googleConnection.findMany()).resolves.toEqual([]);
      await expect(client.googleOAuthAttempt.findMany()).resolves.toEqual([]);
      await expect(client.googleCredentialCleanup.findMany()).resolves.toEqual([]);
      await expect(client.googleSheetsDestination.findMany()).resolves.toEqual([]);
    }

    await expect(withTenantTransaction(api, tenantA, async (transaction) => ({
      connections: await transaction.googleConnection.count(),
      attempts: await transaction.googleOAuthAttempt.count(),
      cleanups: await transaction.googleCredentialCleanup.count(),
      destinations: await transaction.googleSheetsDestination.count(),
    }))).resolves.toEqual({ connections: 1, attempts: 1, cleanups: 1, destinations: 1 });
  });

  it('rejects cross-tenant Google integration updates', async () => {
    await expect(withTenantTransaction(api, tenantA, (transaction) => transaction.googleConnection.update({
      where: { tenantId: tenantB },
      data: { accountEmail: 'forbidden@example.invalid' },
    }))).rejects.toMatchObject({ code: 'P2025' });
    await expect(withTenantTransaction(api, tenantA, (transaction) => transaction.googleSheetsDestination.update({
      where: { tenantId: tenantB },
      data: { sheetName: 'Forbidden' },
    }))).rejects.toMatchObject({ code: 'P2025' });
  });

  it('allows only the API role to consume an exact OAuth attempt', async () => {
    const consumed = await api.$queryRaw<Array<{ tenant_id: string; attempt_id: string }>>`
      SELECT tenant_id, attempt_id
      FROM public.api_consume_google_oauth_attempt(${'hash-tenant-a'}, ${new Date('2026-09-30T12:00:00.000Z')})
    `;
    expect(consumed).toEqual([{ tenant_id: tenantA, attempt_id: attemptA }]);
    await expect(api.$queryRaw`
      SELECT * FROM public.api_consume_google_oauth_attempt(${'hash-tenant-a'}, ${new Date('2026-09-30T12:00:01.000Z')})
    `).resolves.toEqual([]);
    await expect(worker.$queryRaw`
      SELECT * FROM public.api_consume_google_oauth_attempt(${'hash-tenant-b'}, ${new Date('2026-09-30T12:00:00.000Z')})
    `).rejects.toMatchObject({ code: 'P2010' });
  });

  it('allows only the API role to discover bounded cleanup routing identifiers', async () => {
    const rows = await api.$queryRaw<Array<{ tenant_id: string; cleanup_id: string }>>`
      SELECT tenant_id, cleanup_id
      FROM public.api_due_google_credential_cleanups(${100})
      ORDER BY tenant_id
    `;
    expect(rows).toEqual([
      { tenant_id: tenantA, cleanup_id: cleanupA },
      { tenant_id: tenantB, cleanup_id: cleanupB },
    ]);
    await expect(worker.$queryRaw`
      SELECT * FROM public.api_due_google_credential_cleanups(${100})
    `).rejects.toMatchObject({ code: 'P2010' });
  });
});

async function seedTenantIntegration(
  pool: pg.Pool,
  tenantId: string,
  userId: string,
  suffix: string,
  attemptId: string,
  cleanupId: string,
): Promise<void> {
  const connectionId = crypto.randomUUID();
  const generationId = crypto.randomUUID();
  await pool.query('INSERT INTO tenants (id, key, name) VALUES ($1, $2, $3)', [tenantId, suffix, `Fictional ${suffix}`]);
  await pool.query(`INSERT INTO users (id, email, name, status, updated_at)
    VALUES ($1, $2, $3, 'ACTIVE', NOW())`, [userId, `${suffix}@example.invalid`, `Fictional ${suffix}`]);
  await pool.query(`INSERT INTO google_connections
    (id, tenant_id, google_subject, account_email, status, encrypted_refresh_token, credential_generation_id, connected_by_user_id, updated_at)
    VALUES ($1, $2, $3, $4, 'ACTIVE', $5, $6, $7, NOW())`, [
    connectionId,
    tenantId,
    `subject-${suffix}`,
    `${suffix}@example.invalid`,
    `fictional-token-${suffix}`,
    generationId,
    userId,
  ]);
  await pool.query(`INSERT INTO google_oauth_attempts
    (id, token_hash, tenant_id, user_id, expires_at)
    VALUES ($1, $2, $3, $4, $5)`, [attemptId, `hash-${suffix}`, tenantId, userId, new Date('2099-01-01T00:00:00.000Z')]);
  await pool.query(`INSERT INTO google_credential_cleanups
    (id, tenant_id, credential_generation_id, encrypted_refresh_token, status, updated_at)
    VALUES ($1, $2, $3, $4, 'PENDING', NOW())`, [cleanupId, tenantId, crypto.randomUUID(), `fictional-cleanup-${suffix}`]);
  await pool.query(`INSERT INTO google_sheets_destinations
    (id, tenant_id, spreadsheet_id, sheet_name, credential_ref, required_headers, status, updated_at)
    VALUES ($1, $2, $3, 'Orders', $4, '[]'::jsonb, 'ACTIVE', NOW())`, [
    crypto.randomUUID(),
    tenantId,
    `spreadsheet-${suffix}`,
    connectionId,
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
