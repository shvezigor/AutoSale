import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from './client.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { PlatformChannelGate } from './platform-channel-gate.js';
import { configureRuntimeDatabaseRoles } from './runtime-database-roles.js';

const apiPassword = 'fictional-api-password-32-characters';
const workerPassword = 'fictional-worker-password-32-chars';
const backupPassword = 'fictional-backup-password-32-chars';

describe('platform social-channel flags', () => {
  let container: StartedPostgreSqlContainer;
  let admin: pg.Pool;
  let apiPool: pg.Pool;
  let workerPool: pg.Pool;
  let backupPool: pg.Pool;
  let api: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    admin = new pg.Pool({ connectionString: container.getConnectionUri() });
    await applyMigrations(admin);
    await configureRuntimeDatabaseRoles(container.getConnectionUri(), { apiPassword, workerPassword, backupPassword });
    apiPool = new pg.Pool({ connectionString: runtimeUrl(container.getConnectionUri(), 'autosale_api', apiPassword) });
    workerPool = new pg.Pool({ connectionString: runtimeUrl(container.getConnectionUri(), 'autosale_worker', workerPassword) });
    backupPool = new pg.Pool({ connectionString: runtimeUrl(container.getConnectionUri(), 'autosale_backup', backupPassword) });
    api = createPrismaClient(runtimeUrl(container.getConnectionUri(), 'autosale_api', apiPassword));
  }, 60_000);

  afterAll(async () => {
    await api?.$disconnect();
    await apiPool?.end();
    await workerPool?.end();
    await backupPool?.end();
    await admin?.end();
    await container?.stop();
  });

  it('starts fail-closed and applies the deployment ceiling with a real database row', async () => {
    const gate = new PlatformChannelGate(api, {
      FACEBOOK_MESSENGER: true,
      TIKTOK_BUSINESS_MESSAGING: false,
    });

    await expect(gate.isEnabled('FACEBOOK_MESSENGER')).resolves.toBe(false);
    await apiPool.query(`INSERT INTO platform_feature_flags (key, enabled)
      VALUES ('FACEBOOK_MESSENGER', TRUE), ('TIKTOK_BUSINESS_MESSAGING', TRUE)`);
    await expect(gate.isEnabled('FACEBOOK_MESSENGER')).resolves.toBe(true);
    await expect(gate.isEnabled('TIKTOK_BUSINESS_MESSAGING')).resolves.toBe(false);
  });

  it('lets workers and backup read flags but only the API mutate them', async () => {
    await expect(workerPool.query('SELECT key, enabled FROM platform_feature_flags ORDER BY key'))
      .resolves.toMatchObject({ rows: expect.any(Array) });
    await expect(backupPool.query('SELECT key, enabled FROM platform_feature_flags ORDER BY key'))
      .resolves.toMatchObject({ rows: expect.any(Array) });

    await expect(workerPool.query(`UPDATE platform_feature_flags SET enabled = FALSE
      WHERE key = 'FACEBOOK_MESSENGER'`)).rejects.toMatchObject({ code: '42501' });
    await expect(workerPool.query(`INSERT INTO platform_feature_flags (key, enabled)
      VALUES ('FACEBOOK_MESSENGER', FALSE) ON CONFLICT (key) DO UPDATE SET enabled = FALSE`))
      .rejects.toMatchObject({ code: '42501' });
    await expect(workerPool.query('TRUNCATE platform_feature_flags')).rejects.toMatchObject({ code: '42501' });
    await expect(backupPool.query(`DELETE FROM platform_feature_flags
      WHERE key = 'FACEBOOK_MESSENGER'`)).rejects.toMatchObject({ code: '42501' });
  });

  it('rejects unknown feature keys at the database boundary', async () => {
    await expect(apiPool.query(`INSERT INTO platform_feature_flags (key, enabled)
      VALUES ('UNKNOWN_PROVIDER', TRUE)`)).rejects.toMatchObject({ code: '23514' });
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
