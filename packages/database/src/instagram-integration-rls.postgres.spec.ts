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
const stateA = '55555555-5555-4555-8555-555555555555';
const cleanupA = '66666666-6666-4666-8666-666666666666';
const avatarA = '77777777-7777-4777-8777-777777777777';
const avatarB = '88888888-8888-4888-8888-888888888888';

describe('Instagram integration state row-level security', () => {
  let container: StartedPostgreSqlContainer;
  let admin: pg.Pool;
  let api: PrismaClient;
  let worker: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    admin = new pg.Pool({ connectionString: container.getConnectionUri() });
    await applyMigrations(admin);
    await seedTenantIntegration(admin, tenantA, userA, 'tenant-a', stateA, cleanupA, avatarA);
    await seedTenantIntegration(
      admin,
      tenantB,
      userB,
      'tenant-b',
      '99999999-9999-4999-8999-999999999999',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      avatarB,
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
      await expect(client.instagramConnection.findMany()).resolves.toEqual([]);
      await expect(client.instagramOAuthState.findMany()).resolves.toEqual([]);
      await expect(client.instagramCredentialCleanup.findMany()).resolves.toEqual([]);
      await expect(client.instagramAvatarCleanup.findMany()).resolves.toEqual([]);
    }

    await expect(withTenantTransaction(api, tenantA, async (tx) => ({
      connections: await tx.instagramConnection.count(),
      states: await tx.instagramOAuthState.count(),
      credentials: await tx.instagramCredentialCleanup.count(),
      avatars: await tx.instagramAvatarCleanup.count(),
    }))).resolves.toEqual({ connections: 1, states: 1, credentials: 1, avatars: 1 });
  });

  it('rejects cross-tenant integration state updates', async () => {
    await expect(withTenantTransaction(api, tenantA, (tx) => tx.instagramConnection.update({
      where: { tenantId: tenantB },
      data: { displayName: 'Forbidden' },
    }))).rejects.toMatchObject({ code: 'P2025' });
    await expect(withTenantTransaction(api, tenantA, (tx) => tx.instagramAvatarCleanup.update({
      where: { id: avatarB },
      data: { status: 'SUCCEEDED' },
    }))).rejects.toMatchObject({ code: 'P2025' });
  });

  it('allows only the API role to resolve exact provider authority and consume OAuth state', async () => {
    const account = await api.$queryRaw<Array<{ tenant_id: string }>>`
      SELECT tenant_id FROM public.api_instagram_tenant_for_account(${'account-tenant-a'})
    `;
    expect(account).toEqual([{ tenant_id: tenantA }]);

    const consumed = await api.$queryRaw<Array<{ tenant_id: string; state_id: string }>>`
      SELECT tenant_id, state_id
      FROM public.api_consume_instagram_oauth_state(${'hash-tenant-a'}, ${new Date('2026-09-30T12:00:00.000Z')})
    `;
    expect(consumed).toEqual([{ tenant_id: tenantA, state_id: stateA }]);
    await expect(api.$queryRaw`
      SELECT * FROM public.api_consume_instagram_oauth_state(${'hash-tenant-a'}, ${new Date('2026-09-30T12:00:01.000Z')})
    `).resolves.toEqual([]);

    await expect(worker.$queryRaw`
      SELECT * FROM public.api_instagram_tenant_for_account(${'account-tenant-a'})
    `).rejects.toMatchObject({ code: 'P2010' });
    await expect(worker.$queryRaw`
      SELECT * FROM public.api_consume_instagram_oauth_state(${'hash-tenant-b'}, ${new Date('2026-09-30T12:00:00.000Z')})
    `).rejects.toMatchObject({ code: 'P2010' });
  });

  it('allows only the worker role to discover bounded avatar cleanup identifiers', async () => {
    const rows = await worker.$queryRaw<Array<{ tenant_id: string; cleanup_id: string }>>`
      SELECT tenant_id, cleanup_id
      FROM public.worker_due_instagram_avatar_cleanups(${new Date('2099-01-01T00:00:00.000Z')}, 100)
      ORDER BY tenant_id
    `;
    expect(rows).toEqual([
      { tenant_id: tenantA, cleanup_id: avatarA },
      { tenant_id: tenantB, cleanup_id: avatarB },
    ]);
    await expect(api.$queryRaw`
      SELECT * FROM public.worker_due_instagram_avatar_cleanups(${new Date('2099-01-01T00:00:00.000Z')}, 100)
    `).rejects.toMatchObject({ code: 'P2010' });
  });
});

async function seedTenantIntegration(
  pool: pg.Pool,
  tenantId: string,
  userId: string,
  suffix: string,
  stateId: string,
  cleanupId: string,
  avatarId: string,
): Promise<void> {
  await pool.query('INSERT INTO tenants (id, key, name) VALUES ($1, $2, $3)', [tenantId, suffix, `Fictional ${suffix}`]);
  await pool.query(`INSERT INTO users (id, email, name, status, updated_at)
    VALUES ($1, $2, $3, 'ACTIVE', NOW())`, [userId, `${suffix}@example.invalid`, `Fictional ${suffix}`]);
  await pool.query(`INSERT INTO instagram_connections
    (id, tenant_id, external_account_id, display_name, status, encrypted_access_token, credential_generation_id, connected_by_user_id, updated_at)
    VALUES ($1, $2, $3, $4, 'ACTIVE', $5, $6, $7, NOW())`, [
    crypto.randomUUID(),
    tenantId,
    `account-${suffix}`,
    `@${suffix}`,
    `fictional-token-${suffix}`,
    crypto.randomUUID(),
    userId,
  ]);
  await pool.query(`INSERT INTO instagram_oauth_states
    (id, token_hash, tenant_id, user_id, expires_at)
    VALUES ($1, $2, $3, $4, $5)`, [stateId, `hash-${suffix}`, tenantId, userId, new Date('2099-01-01T00:00:00.000Z')]);
  await pool.query(`INSERT INTO instagram_credential_cleanups
    (id, credential_generation_id, tenant_id, external_account_id, encrypted_access_token, state, updated_at)
    VALUES ($1, $2, $3, $4, $5, 'REQUIRED', NOW())`, [
    cleanupId,
    crypto.randomUUID(),
    tenantId,
    `cleanup-account-${suffix}`,
    `fictional-cleanup-token-${suffix}`,
  ]);
  await pool.query(`INSERT INTO instagram_avatar_cleanups
    (id, tenant_id, storage_key, status, next_attempt_at, updated_at)
    VALUES ($1, $2, $3, 'PENDING', $4, NOW())`, [
    avatarId,
    tenantId,
    `${tenantId}/avatars/fictional-${suffix}.jpg`,
    new Date('2026-09-30T11:00:00.000Z'),
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
