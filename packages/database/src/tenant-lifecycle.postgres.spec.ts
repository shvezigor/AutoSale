import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { configureRuntimeDatabaseRoles } from './runtime-database-roles.js';

const apiPassword = 'fictional-api-password-32-characters';
const workerPassword = 'fictional-worker-password-32-chars';
const backupPassword = 'fictional-backup-password-32-chars';
const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const adminUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const regularUserId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('tenant lifecycle database authority', () => {
  let container: StartedPostgreSqlContainer;
  let owner: pg.Pool;
  let api: pg.Pool;
  let worker: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    owner = new pg.Pool({ connectionString: container.getConnectionUri() });
    await applyMigrations(owner);
    await owner.query(`INSERT INTO tenants (id, key, name) VALUES
      ($1, 'lifecycle-a', 'Fictional Lifecycle A'),
      ($2, 'lifecycle-b', 'Fictional Lifecycle B')`, [tenantA, tenantB]);
    await owner.query(`INSERT INTO users
      (id, email, name, password_hash, email_verified_at, platform_role, status, updated_at) VALUES
      ($1, 'platform-admin@example.test', 'Fictional Admin', 'not-a-real-hash', NOW(), 'PLATFORM_ADMIN', 'ACTIVE', NOW()),
      ($2, 'regular-user@example.test', 'Fictional User', 'not-a-real-hash', NOW(), 'USER', 'ACTIVE', NOW())`, [adminUserId, regularUserId]);
    await configureRuntimeDatabaseRoles(container.getConnectionUri(), { apiPassword, workerPassword, backupPassword });
    api = new pg.Pool({ connectionString: runtimeUrl(container.getConnectionUri(), 'autosale_api', apiPassword) });
    worker = new pg.Pool({ connectionString: runtimeUrl(container.getConnectionUri(), 'autosale_worker', workerPassword) });
  }, 60_000);

  afterAll(async () => {
    await api?.end();
    await worker?.end();
    await owner?.end();
    await container?.stop();
  });

  it('fails closed without tenant context and exposes only the selected tenant inside a transaction', async () => {
    const requestId = await createLifecycleRequest(api, adminUserId, tenantA, 'EXPORT', '33333333-3333-4333-8333-333333333333');

    await expect(api.query('SELECT id FROM tenant_lifecycle_requests')).resolves.toMatchObject({ rows: [] });
    await expect(worker.query('SELECT id FROM tenant_lifecycle_requests')).resolves.toMatchObject({ rows: [] });

    const client = await api.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(client.query('SELECT id FROM tenant_lifecycle_requests')).resolves.toMatchObject({ rows: [{ id: requestId }] });
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('creates a deletion preparation only for an active platform administrator and freezes it immediately', async () => {
    const denied = await api.query(
      `SELECT * FROM api_platform_create_tenant_lifecycle_request($1, $2, 'DELETE', 'ADMINISTRATIVE_TEST', $3, 'hash-regular', NOW())`,
      [regularUserId, tenantB, '44444444-4444-4444-8444-444444444444'],
    );
    expect(denied.rows).toEqual([]);

    const created = await api.query<{
      request_id: string; tenant_id: string; kind: string; status: string; ingestion_frozen_at: Date | null; replayed: boolean;
    }>(
      `SELECT * FROM api_platform_create_tenant_lifecycle_request($1, $2, 'DELETE', 'ADMINISTRATIVE_TEST', $3, 'hash-delete', NOW())`,
      [adminUserId, tenantB, '55555555-5555-4555-8555-555555555555'],
    );

    expect(created.rows).toEqual([expect.objectContaining({
      tenant_id: tenantB,
      kind: 'DELETE',
      status: 'REQUESTED',
      replayed: false,
      ingestion_frozen_at: expect.any(Date),
    })]);
  });

  it('replays an equal idempotency request and rejects a conflicting payload', async () => {
    const key = '66666666-6666-4666-8666-666666666666';
    const first = await api.query(
      `SELECT * FROM api_platform_create_tenant_lifecycle_request($1, $2, 'EXPORT', 'ADMINISTRATIVE_TEST', $3, 'same-hash', NOW())`,
      [adminUserId, tenantA, key],
    );
    const replay = await api.query(
      `SELECT * FROM api_platform_create_tenant_lifecycle_request($1, $2, 'EXPORT', 'ADMINISTRATIVE_TEST', $3, 'same-hash', NOW())`,
      [adminUserId, tenantA, key],
    );

    expect(replay.rows[0]).toEqual(expect.objectContaining({ request_id: first.rows[0]!.request_id, replayed: true }));
    await expect(api.query(
      `SELECT * FROM api_platform_create_tenant_lifecycle_request($1, $2, 'EXPORT', 'CONTROLLER_REQUEST', $3, 'different-hash', NOW())`,
      [adminUserId, tenantA, key],
    )).rejects.toMatchObject({ code: 'P0001', message: expect.stringContaining('LIFECYCLE_IDEMPOTENCY_CONFLICT') });
  });

  it('gives only the worker bounded due-work directories', async () => {
    await expect(worker.query('SELECT * FROM worker_due_tenant_lifecycle_requests(NOW(), 50)'))
      .resolves.toMatchObject({ rows: expect.arrayContaining([expect.objectContaining({ tenant_id: tenantA })]) });
    await expect(api.query('SELECT * FROM worker_due_tenant_lifecycle_requests(NOW(), 50)'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(worker.query('SELECT * FROM api_platform_tenant_lifecycle_requests($1)', [adminUserId]))
      .rejects.toMatchObject({ code: '42501' });
  });

  it('protects retention previews with the same fail-closed isolation', async () => {
    const created = await api.query(
      `SELECT * FROM api_platform_create_retention_dry_run($1, $2, $3, 'retention-hash', NOW())`,
      [adminUserId, tenantA, '77777777-7777-4777-8777-777777777777'],
    );
    expect(created.rows).toEqual([expect.objectContaining({ tenant_id: tenantA, status: 'REQUESTED', replayed: false })]);
    await expect(api.query('SELECT id FROM tenant_retention_dry_runs')).resolves.toMatchObject({ rows: [] });
    await expect(worker.query('SELECT * FROM worker_due_retention_dry_runs(NOW(), 50)'))
      .resolves.toMatchObject({ rows: [expect.objectContaining({ tenant_id: tenantA })] });
  });
});

async function createLifecycleRequest(
  client: pg.Pool,
  actorUserId: string,
  tenantId: string,
  kind: 'EXPORT' | 'DELETE',
  idempotencyKey: string,
): Promise<string> {
  const result = await client.query<{ request_id: string }>(
    `SELECT * FROM api_platform_create_tenant_lifecycle_request($1, $2, $3, 'ADMINISTRATIVE_TEST', $4, $5, NOW())`,
    [actorUserId, tenantId, kind, idempotencyKey, `hash-${idempotencyKey}`],
  );
  return result.rows[0]!.request_id;
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
