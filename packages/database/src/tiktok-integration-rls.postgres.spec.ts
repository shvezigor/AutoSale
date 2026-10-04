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
const backupPassword = 'fictional-backup-password-32-chars';
const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const userA = '33333333-3333-4333-8333-333333333333';
const userB = '44444444-4444-4444-8444-444444444444';
const attemptA = '55555555-5555-4555-8555-555555555555';

describe('TikTok Business Messaging integration row-level security', () => {
  let container: StartedPostgreSqlContainer;
  let admin: pg.Pool;
  let api: PrismaClient;
  let worker: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    admin = new pg.Pool({ connectionString: container.getConnectionUri() });
    await applyMigrations(admin);
    await seedTenantIntegration(admin, tenantA, userA, 'tenant-a', attemptA, 'ACTIVE');
    await seedTenantIntegration(
      admin,
      tenantB,
      userB,
      'tenant-b',
      '66666666-6666-4666-8666-666666666666',
      'INBOUND_ONLY',
    );
    await configureRuntimeDatabaseRoles(container.getConnectionUri(), { apiPassword, workerPassword, backupPassword });
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
      await expect(client.tikTokConnection.findMany()).resolves.toEqual([]);
      await expect(client.tikTokOAuthAttempt.findMany()).resolves.toEqual([]);
      await expect(client.tikTokCredentialCleanup.findMany()).resolves.toEqual([]);
    }

    await expect(withTenantTransaction(api, tenantA, async (transaction) => ({
      connections: await transaction.tikTokConnection.count(),
      attempts: await transaction.tikTokOAuthAttempt.count(),
      cleanups: await transaction.tikTokCredentialCleanup.count(),
    }))).resolves.toEqual({ connections: 1, attempts: 1, cleanups: 1 });
  });

  it('rejects cross-tenant connection updates and relation inserts', async () => {
    await expect(withTenantTransaction(api, tenantA, (transaction) => transaction.tikTokConnection.update({
      where: { tenantId: tenantB },
      data: { displayName: 'Forbidden' },
    }))).rejects.toMatchObject({ code: 'P2025' });

    await expect(withTenantTransaction(api, tenantA, (transaction) => transaction.tikTokOAuthAttempt.create({
      data: {
        tokenHash: 'cross-tenant-attempt',
        tenantId: tenantA,
        userId: userB,
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      },
    }))).rejects.toBeTruthy();
  });

  it('allows only the API role to resolve an eligible account and consume OAuth state once', async () => {
    await expect(api.$queryRaw<Array<{ tenant_id: string }>>`
      SELECT tenant_id FROM public.api_tiktok_tenant_for_account(${'account-tenant-a'})
    `).resolves.toEqual([{ tenant_id: tenantA }]);
    await expect(api.$queryRaw<Array<{ tenant_id: string }>>`
      SELECT tenant_id FROM public.api_tiktok_tenant_for_account(${'account-tenant-b'})
    `).resolves.toEqual([{ tenant_id: tenantB }]);

    const consumed = await api.$queryRaw<Array<{ tenant_id: string; attempt_id: string }>>`
      SELECT tenant_id, attempt_id
      FROM public.api_consume_tiktok_oauth_attempt(${'hash-tenant-a'}, ${new Date('2026-10-04T12:00:00.000Z')})
    `;
    expect(consumed).toEqual([{ tenant_id: tenantA, attempt_id: attemptA }]);
    await expect(api.$queryRaw`
      SELECT * FROM public.api_consume_tiktok_oauth_attempt(${'hash-tenant-a'}, ${new Date('2026-10-04T12:00:01.000Z')})
    `).resolves.toEqual([]);

    await expect(worker.$queryRaw`
      SELECT * FROM public.api_tiktok_tenant_for_account(${'account-tenant-a'})
    `).rejects.toMatchObject({ code: 'P2010' });
    await expect(worker.$queryRaw`
      SELECT * FROM public.api_consume_tiktok_oauth_attempt(${'hash-tenant-b'}, ${new Date('2026-10-04T12:00:00.000Z')})
    `).rejects.toMatchObject({ code: 'P2010' });
  });

  it('keeps shared app webhook lifecycle out of tenant credential cleanup records', async () => {
    const columns = await admin.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'tiktok_credential_cleanups'
      ORDER BY column_name
    `);

    expect(columns.rows.map(({ column_name }) => column_name)).not.toEqual(expect.arrayContaining([
      'webhook_delete_status',
      'webhook_delete_attempted_at',
      'webhook_delete_succeeded_at',
    ]));
  });
});

async function seedTenantIntegration(
  pool: pg.Pool,
  tenantId: string,
  userId: string,
  suffix: string,
  attemptId: string,
  status: 'ACTIVE' | 'INBOUND_ONLY',
): Promise<void> {
  await pool.query('INSERT INTO tenants (id, key, name) VALUES ($1, $2, $3)', [tenantId, suffix, `Fictional ${suffix}`]);
  await pool.query(`INSERT INTO users (id, email, name, status, updated_at)
    VALUES ($1, $2, $3, 'ACTIVE', NOW())`, [userId, `${suffix}@example.invalid`, `Fictional ${suffix}`]);
  await pool.query(`INSERT INTO tenant_memberships (id, user_id, tenant_id, role, status, updated_at)
    VALUES ($1, $2, $3, 'OWNER', 'ACTIVE', NOW())`, [crypto.randomUUID(), userId, tenantId]);
  await pool.query(`INSERT INTO tiktok_connections
    (id, tenant_id, external_account_id, display_name, status, capabilities,
     encrypted_access_token, encrypted_refresh_token, credential_generation_id,
     connected_by_user_id, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, NOW())`, [
    crypto.randomUUID(),
    tenantId,
    `account-${suffix}`,
    `Fictional TikTok ${suffix}`,
    status,
    JSON.stringify({ receiveMessages: true, sendText: status === 'ACTIVE', sendImage: false }),
    `fictional-access-${suffix}`,
    `fictional-refresh-${suffix}`,
    crypto.randomUUID(),
    userId,
  ]);
  await pool.query(`INSERT INTO tiktok_oauth_attempts
    (id, token_hash, tenant_id, user_id, expires_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, NOW())`, [
    attemptId,
    `hash-${suffix}`,
    tenantId,
    userId,
    new Date('2099-01-01T00:00:00.000Z'),
  ]);
  await pool.query(`INSERT INTO tiktok_credential_cleanups
    (id, credential_generation_id, tenant_id, external_account_id,
     encrypted_access_token, encrypted_refresh_token, state, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, 'REQUIRED', NOW())`, [
    crypto.randomUUID(),
    crypto.randomUUID(),
    tenantId,
    `cleanup-account-${suffix}`,
    `fictional-cleanup-access-${suffix}`,
    `fictional-cleanup-refresh-${suffix}`,
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
