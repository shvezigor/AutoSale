import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { configureRuntimeDatabaseRoles, runtimeDatabaseRoleConfigFromEnv } from './runtime-database-roles.js';

const apiPassword = 'fictional-api-password-32-characters';
const workerPassword = 'fictional-worker-password-32-chars';

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

  it('gives API and worker data access without owner, DDL, superuser, or RLS bypass authority', async () => {
    await configureRuntimeDatabaseRoles(container.getConnectionUri(), { apiPassword, workerPassword });

    const api = new pg.Pool({ connectionString: runtimeUrl(container.getConnectionUri(), 'autosale_api', apiPassword) });
    const worker = new pg.Pool({ connectionString: runtimeUrl(container.getConnectionUri(), 'autosale_worker', workerPassword) });

    try {
      const roles = await adminPool.query<{
        rolname: string;
        rolsuper: boolean;
        rolcreaterole: boolean;
        rolcreatedb: boolean;
        rolbypassrls: boolean;
      }>(`SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls
          FROM pg_roles WHERE rolname IN ('autosale_api', 'autosale_worker') ORDER BY rolname`);

      expect(roles.rows).toEqual([
        { rolname: 'autosale_api', rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolbypassrls: false },
        { rolname: 'autosale_worker', rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolbypassrls: false },
      ]);

      const tenantId = '11111111-1111-4111-8111-111111111111';
      await api.query('INSERT INTO tenants (id, key, name) VALUES ($1, $2, $3)', [tenantId, 'role-test', 'Fictional Role Test']);
      await expect(worker.query('SELECT name FROM tenants WHERE id = $1', [tenantId]))
        .resolves.toMatchObject({ rows: [{ name: 'Fictional Role Test' }] });

      await expect(api.query('CREATE TABLE forbidden_api_ddl (id integer)')).rejects.toMatchObject({ code: '42501' });
      await expect(worker.query('ALTER TABLE tenants ADD COLUMN forbidden_worker_ddl text')).rejects.toMatchObject({ code: '42501' });
    } finally {
      await api.end();
      await worker.end();
    }
  });

  it('rejects weak or shared runtime passwords', async () => {
    await expect(configureRuntimeDatabaseRoles(container.getConnectionUri(), {
      apiPassword: 'short',
      workerPassword,
    })).rejects.toThrow(/at least 32/i);

    await expect(configureRuntimeDatabaseRoles(container.getConnectionUri(), {
      apiPassword,
      workerPassword: apiPassword,
    })).rejects.toThrow(/different/i);

    await expect(configureRuntimeDatabaseRoles(container.getConnectionUri(), {
      apiPassword: 'fictional:password-that-needs-url-encoding',
      workerPassword,
    })).rejects.toThrow(/URL-safe/i);
  });

  it('loads role credentials without exposing an owner fallback', () => {
    expect(runtimeDatabaseRoleConfigFromEnv({
      DATABASE_URL: 'postgresql://owner:secret@postgres:5432/autosale',
      POSTGRES_API_PASSWORD: apiPassword,
      POSTGRES_WORKER_PASSWORD: workerPassword,
    })).toEqual({
      connectionString: 'postgresql://owner:secret@postgres:5432/autosale',
      passwords: { apiPassword, workerPassword },
    });

    expect(() => runtimeDatabaseRoleConfigFromEnv({
      DATABASE_URL: 'postgresql://owner:secret@postgres:5432/autosale',
      POSTGRES_API_PASSWORD: apiPassword,
    })).toThrow(/POSTGRES_WORKER_PASSWORD/);
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
