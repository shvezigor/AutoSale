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

describe('Facebook Messenger integration state row-level security', () => {
  let container: StartedPostgreSqlContainer;
  let admin: pg.Pool;
  let api: PrismaClient;
  let worker: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    admin = new pg.Pool({ connectionString: container.getConnectionUri() });
    await applyMigrations(admin);
    await seedTenantIntegration(admin, tenantA, userA, 'tenant-a', attemptA);
    await seedTenantIntegration(
      admin,
      tenantB,
      userB,
      'tenant-b',
      '66666666-6666-4666-8666-666666666666',
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
      await expect(client.facebookConnection.findMany()).resolves.toEqual([]);
      await expect(client.facebookOAuthAttempt.findMany()).resolves.toEqual([]);
      await expect(client.facebookCredentialCleanup.findMany()).resolves.toEqual([]);
    }

    await expect(withTenantTransaction(api, tenantA, async (tx) => ({
      connections: await tx.facebookConnection.count(),
      attempts: await tx.facebookOAuthAttempt.count(),
      cleanups: await tx.facebookCredentialCleanup.count(),
    }))).resolves.toEqual({ connections: 1, attempts: 1, cleanups: 1 });
  });

  it('rejects cross-tenant integration state updates', async () => {
    await expect(withTenantTransaction(api, tenantA, (tx) => tx.facebookConnection.update({
      where: { tenantId: tenantB },
      data: { pageName: 'Forbidden' },
    }))).rejects.toMatchObject({ code: 'P2025' });
  });

  it('allows only the API role to resolve exact Page authority and consume OAuth state once', async () => {
    const page = await api.$queryRaw<Array<{ tenant_id: string }>>`
      SELECT tenant_id FROM public.api_facebook_tenant_for_page(${'page-tenant-a'})
    `;
    expect(page).toEqual([{ tenant_id: tenantA }]);

    const consumed = await api.$queryRaw<Array<{ tenant_id: string; attempt_id: string }>>`
      SELECT tenant_id, attempt_id
      FROM public.api_consume_facebook_oauth_attempt(${'hash-tenant-a'}, ${new Date('2026-10-02T12:00:00.000Z')})
    `;
    expect(consumed).toEqual([{ tenant_id: tenantA, attempt_id: attemptA }]);
    await expect(api.$queryRaw`
      SELECT * FROM public.api_consume_facebook_oauth_attempt(${'hash-tenant-a'}, ${new Date('2026-10-02T12:00:01.000Z')})
    `).resolves.toEqual([]);

    await expect(worker.$queryRaw`
      SELECT * FROM public.api_facebook_tenant_for_page(${'page-tenant-a'})
    `).rejects.toMatchObject({ code: 'P2010' });
    await expect(worker.$queryRaw`
      SELECT * FROM public.api_consume_facebook_oauth_attempt(${'hash-tenant-b'}, ${new Date('2026-10-02T12:00:00.000Z')})
    `).rejects.toMatchObject({ code: 'P2010' });
  });
});

async function seedTenantIntegration(
  pool: pg.Pool,
  tenantId: string,
  userId: string,
  suffix: string,
  attemptId: string,
): Promise<void> {
  await pool.query('INSERT INTO tenants (id, key, name) VALUES ($1, $2, $3)', [tenantId, suffix, `Fictional ${suffix}`]);
  await pool.query(`INSERT INTO users (id, email, name, status, updated_at)
    VALUES ($1, $2, $3, 'ACTIVE', NOW())`, [userId, `${suffix}@example.invalid`, `Fictional ${suffix}`]);
  await pool.query(`INSERT INTO facebook_connections
    (id, tenant_id, external_page_id, page_name, status, encrypted_page_access_token,
     credential_generation_id, connected_by_user_id, updated_at)
    VALUES ($1, $2, $3, $4, 'ACTIVE', $5, $6, $7, NOW())`, [
    crypto.randomUUID(),
    tenantId,
    `page-${suffix}`,
    `Fictional Page ${suffix}`,
    `fictional-token-${suffix}`,
    crypto.randomUUID(),
    userId,
  ]);
  await pool.query(`INSERT INTO facebook_oauth_attempts
    (id, token_hash, tenant_id, user_id, expires_at, encrypted_page_candidates, candidate_expires_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $5, NOW())`, [
    attemptId,
    `hash-${suffix}`,
    tenantId,
    userId,
    new Date('2099-01-01T00:00:00.000Z'),
    `fictional-encrypted-candidates-${suffix}`,
  ]);
  await pool.query(`INSERT INTO facebook_credential_cleanups
    (id, credential_generation_id, tenant_id, external_page_id, encrypted_page_access_token, state, updated_at)
    VALUES ($1, $2, $3, $4, $5, 'REQUIRED', NOW())`, [
    crypto.randomUUID(),
    crypto.randomUUID(),
    tenantId,
    `cleanup-page-${suffix}`,
    `fictional-cleanup-token-${suffix}`,
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
