import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const preCleanupMigrations = [
  '20260826090000_init_webhook_events',
  '20260827160000_self_hosted_auth',
  '20260827170000_tenant_access_status',
  '20260827230000_instagram_connections',
  '20260828_meta_instagram_oauth',
  '20260828150000_instagram_oauth_attempt_guard',
];
const migrationsDirectory = [
  resolve(process.cwd(), 'packages/database/prisma/migrations'),
  resolve(process.cwd(), '../../packages/database/prisma/migrations'),
].find((directory) => existsSync(directory)) ?? resolve(process.cwd(), 'packages/database/prisma/migrations');

describe('Instagram credential cleanup migration', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let pool: Pool | undefined;

  beforeAll(async () => {
    try {
      container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    } catch (error) {
      // Keep the migration spec runnable in environments without Docker while
      // still surfacing real setup failures when a runtime is available.
      if (!(error instanceof Error) || !error.message.includes('Could not find a working container runtime strategy')) {
        throw error;
      }
      return;
    }
    pool = new Pool({ connectionString: container.getConnectionUri() });
    for (const migrationName of preCleanupMigrations) {
      const migration = await readFile(
        resolve(migrationsDirectory, migrationName, 'migration.sql'),
        'utf8',
      );
      await pool.query(migration);
    }
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('moves only disconnected retained credentials into cleanup while preserving active credentials', async (context) => {
    if (!pool || !container) {
      context.skip('PostgreSQL container runtime is unavailable');
      return;
    }
    const activeTenantId = '11111111-1111-4111-8111-111111111111';
    const disconnectedTenantId = '22222222-2222-4222-8222-222222222222';
    const emptyDisconnectedTenantId = '66666666-6666-4666-8666-666666666666';
    const userId = '33333333-3333-4333-8333-333333333333';
    await pool.query(`
      INSERT INTO "tenants" ("id", "key", "name")
      VALUES
        ($1, 'active-shop', 'Active Shop'),
        ($2, 'disconnected-shop', 'Disconnected Shop'),
        ($3, 'empty-disconnected-shop', 'Empty Disconnected Shop')
    `, [activeTenantId, disconnectedTenantId, emptyDisconnectedTenantId]);
    await pool.query(`
      INSERT INTO "users" ("id", "email", "name", "password_hash", "status", "updated_at")
      VALUES ($1, 'owner@example.test', 'Owner', 'hash', 'ACTIVE', CURRENT_TIMESTAMP)
    `, [userId]);
    await pool.query(`
      INSERT INTO "instagram_connections" (
        "id",
        "tenant_id",
        "external_account_id",
        "display_name",
        "status",
        "encrypted_access_token",
        "token_expires_at",
        "granted_scopes",
        "last_error_code",
        "connected_by_user_id",
        "disconnected_at",
        "updated_at"
      )
      VALUES
        (
          '44444444-4444-4444-8444-444444444444',
          $1,
          '17841400000000001',
          'active_shop',
          'ACTIVE',
          'encrypted-active-token',
          '2026-10-27T12:00:00.000Z',
          'instagram_business_basic,instagram_business_manage_messages',
          NULL,
          $4,
          NULL,
          CURRENT_TIMESTAMP
        ),
        (
          '55555555-5555-4555-8555-555555555555',
          $2,
          '17841400000000002',
          'disconnected_shop',
          'DISCONNECTED',
          'encrypted-disconnected-token',
          '2026-10-27T12:00:00.000Z',
          'instagram_business_basic,instagram_business_manage_messages',
          'META_DISCONNECT_CLEANUP_FAILED',
          $4,
          '2026-08-28T12:00:00.000Z',
          CURRENT_TIMESTAMP
        ),
        (
          '77777777-7777-4777-8777-777777777777',
          $3,
          '17841400000000003',
          'empty_disconnected_shop',
          'DISCONNECTED',
          NULL,
          NULL,
          NULL,
          'META_DISCONNECT_CLEANUP_FAILED',
          $4,
          '2026-08-28T12:00:00.000Z',
          CURRENT_TIMESTAMP
        )
    `, [activeTenantId, disconnectedTenantId, emptyDisconnectedTenantId, userId]);

    const cleanupMigration = await readFile(
      resolve(migrationsDirectory, '20260829120000_instagram_credential_cleanup_queue', 'migration.sql'),
      'utf8',
    );
    await pool.query(cleanupMigration);

    const connections = await pool.query<{
      tenant_id: string;
      encrypted_access_token: string | null;
      credential_generation_id: string | null;
      token_expires_at: Date | null;
      granted_scopes: string | null;
      last_error_code: string | null;
    }>(`
      SELECT
        "tenant_id",
        "encrypted_access_token",
        "credential_generation_id",
        "token_expires_at",
        "granted_scopes",
        "last_error_code"
      FROM "instagram_connections"
      ORDER BY "tenant_id"
    `);
    const cleanups = await pool.query<{
      tenant_id: string;
      encrypted_access_token: string;
      credential_generation_id: string;
      source: string;
      state: string;
      unsubscribe_status: string;
      revoke_status: string;
      last_error_code: string | null;
      terminal_at: Date | null;
    }>(`
      SELECT
        "tenant_id",
        "encrypted_access_token",
        "credential_generation_id",
        "source",
        "state",
        "unsubscribe_status",
        "revoke_status",
        "last_error_code",
        "terminal_at"
      FROM "instagram_credential_cleanups"
      ORDER BY "tenant_id"
    `);

    const active = connections.rows.find((row) => row.tenant_id === activeTenantId);
    const disconnected = connections.rows.find((row) => row.tenant_id === disconnectedTenantId);
    const emptyDisconnected = connections.rows.find((row) => row.tenant_id === emptyDisconnectedTenantId);
    expect(active).toMatchObject({
      encrypted_access_token: 'encrypted-active-token',
      token_expires_at: expect.any(Date),
      granted_scopes: 'instagram_business_basic,instagram_business_manage_messages',
      last_error_code: null,
    });
    expect(active?.credential_generation_id).toEqual(expect.any(String));
    expect(disconnected).toMatchObject({
      encrypted_access_token: null,
      token_expires_at: null,
      granted_scopes: null,
      last_error_code: null,
    });
    expect(disconnected?.credential_generation_id).toEqual(expect.any(String));
    expect(emptyDisconnected).toMatchObject({
      encrypted_access_token: null,
      credential_generation_id: null,
      last_error_code: null,
    });
    expect(cleanups.rows).toHaveLength(1);
    expect(cleanups.rows[0]).toMatchObject({
      tenant_id: disconnectedTenantId,
      encrypted_access_token: 'encrypted-disconnected-token',
      credential_generation_id: disconnected?.credential_generation_id,
      source: 'MIGRATION_DISCONNECT',
      state: 'REQUIRED',
      unsubscribe_status: 'PENDING',
      revoke_status: 'PENDING',
      last_error_code: 'META_DISCONNECT_CLEANUP_FAILED',
      terminal_at: null,
    });
  });
});
