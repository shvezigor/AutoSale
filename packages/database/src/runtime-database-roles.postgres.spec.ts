import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { configureRuntimeDatabaseRoles, runtimeDatabaseRoleConfigFromEnv } from './runtime-database-roles.js';

const apiPassword = 'fictional-api-password-32-characters';
const workerPassword = 'fictional-worker-password-32-chars';
const backupPassword = 'fictional-backup-password-32-chars';

describe('runtime database role provisioning', () => {
  let container: StartedPostgreSqlContainer;
  let adminPool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    adminPool = new pg.Pool({ connectionString: container.getConnectionUri() });
    await applyMigrations(adminPool);
  }, 60_000);

  afterAll(async () => {
    await adminPool?.end();
    await container?.stop();
  });

  it('gives runtime roles data access and a read-only backup role with isolated RLS bypass', async () => {
    await configureRuntimeDatabaseRoles(container.getConnectionUri(), { apiPassword, workerPassword, backupPassword });

    const api = new pg.Pool({ connectionString: runtimeUrl(container.getConnectionUri(), 'autosale_api', apiPassword) });
    const worker = new pg.Pool({ connectionString: runtimeUrl(container.getConnectionUri(), 'autosale_worker', workerPassword) });
    const backup = new pg.Pool({ connectionString: runtimeUrl(container.getConnectionUri(), 'autosale_backup', backupPassword) });

    try {
      const roles = await adminPool.query<{
        rolname: string;
        rolsuper: boolean;
        rolcreaterole: boolean;
        rolcreatedb: boolean;
        rolbypassrls: boolean;
      }>(`SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls
          FROM pg_roles WHERE rolname IN ('autosale_api', 'autosale_backup', 'autosale_worker') ORDER BY rolname`);

      expect(roles.rows).toEqual([
        { rolname: 'autosale_api', rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolbypassrls: false },
        { rolname: 'autosale_backup', rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolbypassrls: true },
        { rolname: 'autosale_worker', rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolbypassrls: false },
      ]);

      const tenantId = '11111111-1111-4111-8111-111111111111';
      await api.query('INSERT INTO tenants (id, key, name) VALUES ($1, $2, $3)', [tenantId, 'role-test', 'Fictional Role Test']);
      await expect(worker.query('SELECT name FROM tenants WHERE id = $1', [tenantId]))
        .resolves.toMatchObject({ rows: [{ name: 'Fictional Role Test' }] });

      await expect(api.query('CREATE TABLE forbidden_api_ddl (id integer)')).rejects.toMatchObject({ code: '42501' });
      await expect(worker.query('ALTER TABLE tenants ADD COLUMN forbidden_worker_ddl text')).rejects.toMatchObject({ code: '42501' });

      await adminPool.query(`
        CREATE TABLE backup_rls_fixture (
          id uuid PRIMARY KEY,
          tenant_id uuid NOT NULL,
          value text NOT NULL
        );
        ALTER TABLE backup_rls_fixture ENABLE ROW LEVEL SECURITY;
        ALTER TABLE backup_rls_fixture FORCE ROW LEVEL SECURITY;
        CREATE POLICY backup_rls_fixture_isolation ON backup_rls_fixture
          USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
        INSERT INTO backup_rls_fixture (id, tenant_id, value) VALUES
          ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'tenant-a'),
          ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'tenant-b');
      `);

      await expect(backup.query('SELECT value FROM backup_rls_fixture ORDER BY value'))
        .resolves.toMatchObject({ rows: [{ value: 'tenant-a' }, { value: 'tenant-b' }] });
      await expect(backup.query("UPDATE backup_rls_fixture SET value = 'forbidden'"))
        .rejects.toMatchObject({ code: '42501' });
      await expect(backup.query('CREATE TABLE forbidden_backup_ddl (id integer)'))
        .rejects.toMatchObject({ code: '42501' });
      await expect(backup.query('SELECT * FROM platform_order_counts()'))
        .rejects.toMatchObject({ code: '42501' });
      await expect(backup.query('SET ROLE autosale_api'))
        .rejects.toMatchObject({ code: '42501' });

      const dump = await container.exec([
        'sh',
        '-c',
        `PGPASSWORD=${backupPassword} pg_dump --host=127.0.0.1 --username=autosale_backup --no-owner --no-privileges ${container.getDatabase()}`,
      ]);
      expect(dump.exitCode).toBe(0);
      expect(dump.output).toContain('COPY public.backup_rls_fixture');
      expect(dump.output).toContain('tenant-a');
      expect(dump.output).toContain('tenant-b');
    } finally {
      await api.end();
      await worker.end();
      await backup.end();
    }
  });

  it('rejects weak or shared runtime passwords', async () => {
    await expect(configureRuntimeDatabaseRoles(container.getConnectionUri(), {
      apiPassword: 'short',
      workerPassword,
      backupPassword,
    })).rejects.toThrow(/at least 32/i);

    await expect(configureRuntimeDatabaseRoles(container.getConnectionUri(), {
      apiPassword,
      workerPassword: apiPassword,
      backupPassword,
    })).rejects.toThrow(/different/i);

    await expect(configureRuntimeDatabaseRoles(container.getConnectionUri(), {
      apiPassword: 'fictional:password-that-needs-url-encoding',
      workerPassword,
      backupPassword,
    })).rejects.toThrow(/URL-safe/i);

    await expect(configureRuntimeDatabaseRoles(container.getConnectionUri(), {
      apiPassword,
      workerPassword,
      backupPassword: workerPassword,
    })).rejects.toThrow(/different/i);

    await expect(configureRuntimeDatabaseRoles(
      runtimeUrl(container.getConnectionUri(), 'postgres', backupPassword),
      { apiPassword, workerPassword, backupPassword },
    )).rejects.toThrow(/owner password/i);
  });

  it('loads role credentials without exposing an owner fallback', () => {
    expect(runtimeDatabaseRoleConfigFromEnv({
      DATABASE_URL: 'postgresql://owner:secret@postgres:5432/autosale',
      POSTGRES_API_PASSWORD: apiPassword,
      POSTGRES_WORKER_PASSWORD: workerPassword,
      POSTGRES_BACKUP_PASSWORD: backupPassword,
    })).toEqual({
      connectionString: 'postgresql://owner:secret@postgres:5432/autosale',
      passwords: { apiPassword, workerPassword, backupPassword },
    });

    expect(() => runtimeDatabaseRoleConfigFromEnv({
      DATABASE_URL: 'postgresql://owner:secret@postgres:5432/autosale',
      POSTGRES_API_PASSWORD: apiPassword,
      POSTGRES_BACKUP_PASSWORD: backupPassword,
    })).toThrow(/POSTGRES_WORKER_PASSWORD/);

    expect(() => runtimeDatabaseRoleConfigFromEnv({
      DATABASE_URL: 'postgresql://owner:secret@postgres:5432/autosale',
      POSTGRES_API_PASSWORD: apiPassword,
      POSTGRES_WORKER_PASSWORD: workerPassword,
    })).toThrow(/POSTGRES_BACKUP_PASSWORD/);
  });
});

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
