import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const userA = '33333333-3333-4333-8333-333333333333';
const userB = '44444444-4444-4444-8444-444444444444';

describe('Telegram platform persistence', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    await applyMigrations(pool);
    await pool.query(`INSERT INTO tenants (id, key, name) VALUES
      ($1, 'telegram-a', 'Telegram A'), ($2, 'telegram-b', 'Telegram B')`, [tenantA, tenantB]);
    await pool.query(`INSERT INTO users (id, email, name, status, updated_at) VALUES
      ($1, 'telegram-a@example.com', 'User A', 'ACTIVE', NOW()),
      ($2, 'telegram-b@example.com', 'User B', 'ACTIVE', NOW())`, [userA, userB]);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('consumes an unexpired link attempt only once', async () => {
    await pool.query(`INSERT INTO telegram_link_attempts
      (token_hash, tenant_id, user_id, purpose, return_path, expires_at)
      VALUES ('hash-once', $1, $2, 'PERSONAL', '/settings?tab=telegram', NOW() + INTERVAL '5 minutes')`, [tenantA, userA]);

    const first = await pool.query(`UPDATE telegram_link_attempts SET used_at = NOW()
      WHERE token_hash = 'hash-once' AND used_at IS NULL AND expires_at > NOW()
      RETURNING tenant_id, user_id, purpose`);
    const replay = await pool.query(`UPDATE telegram_link_attempts SET used_at = NOW()
      WHERE token_hash = 'hash-once' AND used_at IS NULL AND expires_at > NOW()
      RETURNING id`);

    expect(first.rows).toEqual([{ tenant_id: tenantA, user_id: userA, purpose: 'PERSONAL' }]);
    expect(replay.rowCount).toBe(0);
  });

  it('allows one Telegram identity in different tenants but not for two users in one tenant', async () => {
    await pool.query(`INSERT INTO telegram_user_bindings
      (tenant_id, user_id, telegram_user_id, private_chat_id, display_name)
      VALUES ($1, $2, '9007199254740991', '101', 'User A'),
             ($3, $4, '9007199254740991', '202', 'User B')`, [tenantA, userA, tenantB, userB]);

    await expect(pool.query(`INSERT INTO telegram_user_bindings
      (tenant_id, user_id, telegram_user_id, private_chat_id, display_name)
      VALUES ($1, $2, '9007199254740991', '303', 'Duplicate')`, [tenantA, userB])).rejects.toMatchObject({ code: '23505' });
  });

  it('stores only one durable delivery per tenant idempotency key', async () => {
    const chat = await pool.query(`INSERT INTO telegram_chats
      (tenant_id, external_chat_id, type, title, route, last_observed_at)
      VALUES ($1, '-1001234567890', 'group', 'Supplier', 'BOT', NOW()) RETURNING id`, [tenantA]);
    const destinationId = String(chat.rows[0]?.id);

    await pool.query(`INSERT INTO telegram_deliveries
      (tenant_id, destination_id, purpose, status, idempotency_key, message_text, next_attempt_at)
      VALUES ($1, $2, 'SUPPLIER_ORDER', 'PENDING', 'order:one:supplier', 'Order summary', NOW())`, [tenantA, destinationId]);

    await expect(pool.query(`INSERT INTO telegram_deliveries
      (tenant_id, destination_id, purpose, status, idempotency_key, message_text, next_attempt_at)
      VALUES ($1, $2, 'SUPPLIER_ORDER', 'PENDING', 'order:one:supplier', 'Duplicate', NOW())`, [tenantA, destinationId])).rejects.toMatchObject({ code: '23505' });

    await expect(pool.query(`INSERT INTO telegram_deliveries
      (tenant_id, destination_id, purpose, status, idempotency_key, message_text, next_attempt_at)
      VALUES ($1, $2, 'SUPPLIER_ORDER', 'PENDING', 'order:one:supplier', 'Cross tenant', NOW())`, [tenantB, destinationId])).rejects.toMatchObject({ code: '23503' });
  });
});

async function applyMigrations(pool: pg.Pool): Promise<void> {
  const root = resolve(fileURLToPath(new URL('../prisma/migrations', import.meta.url)));
  for (const name of (await readdir(root)).sort()) {
    if (name === 'migration_lock.toml') continue;
    await pool.query(await readFile(resolve(root, name, 'migration.sql'), 'utf8'));
  }
}
