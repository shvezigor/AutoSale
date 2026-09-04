import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const tenantId = '11111111-1111-4111-8111-111111111111';
const firstUserId = '22222222-2222-4222-8222-222222222222';
const secondUserId = '33333333-3333-4333-8333-333333333333';

describe('user notification persistence', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    await applyMigrations(pool);
    await pool.query('INSERT INTO tenants (id, key, name) VALUES ($1, $2, $3)', [tenantId, 'notifications', 'Notifications']);
    await pool.query(`INSERT INTO users (id, email, name, status, updated_at) VALUES
      ($1, 'first@example.com', 'First', 'ACTIVE', NOW()),
      ($2, 'second@example.com', 'Second', 'ACTIVE', NOW())`, [firstUserId, secondUserId]);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('keeps notifications isolated by user with unread state', async () => {
    await pool.query(`INSERT INTO user_notifications
      (tenant_id, user_id, type, category, title, action_url)
      VALUES ($1, $2, 'SUCCESS', 'CATALOGUE_IMPORT_COMPLETED', 'Каталог оновлено', '/catalogue'),
             ($1, $3, 'ERROR', 'ORDER_EXPORT_FAILED', 'Експорт не виконано', '/orders/11111111-1111-4111-8111-111111111111')`,
    [tenantId, firstUserId, secondUserId]);

    const firstUserRows = await pool.query('SELECT user_id, read_at FROM user_notifications WHERE tenant_id = $1 AND user_id = $2', [tenantId, firstUserId]);
    expect(firstUserRows.rows).toEqual([{ user_id: firstUserId, read_at: null }]);
  });

  it('cascades notification deletion with the owning user', async () => {
    await pool.query(`INSERT INTO user_notifications
      (tenant_id, user_id, type, category, title)
      VALUES ($1, $2, 'INFO', 'ACCOUNT_EVENT', 'Подія акаунта')`, [tenantId, firstUserId]);

    await pool.query('DELETE FROM users WHERE id = $1', [firstUserId]);
    const remaining = await pool.query('SELECT id FROM user_notifications WHERE user_id = $1', [firstUserId]);
    expect(remaining.rowCount).toBe(0);
  });
});

async function applyMigrations(pool: pg.Pool): Promise<void> {
  const migrationsDirectory = resolve(fileURLToPath(new URL('../prisma/migrations', import.meta.url)));
  for (const name of (await readdir(migrationsDirectory)).sort()) {
    if (name === 'migration_lock.toml') continue;
    const migration = await readFile(resolve(migrationsDirectory, name, 'migration.sql'), 'utf8');
    await pool.query(migration);
  }
}
