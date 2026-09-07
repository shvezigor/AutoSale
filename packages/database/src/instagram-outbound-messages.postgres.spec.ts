import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('Instagram outbound message persistence', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  const tenantA = '11111111-1111-4111-8111-111111111111';
  const tenantB = '22222222-2222-4222-8222-222222222222';
  const userA = '33333333-3333-4333-8333-333333333333';
  const conversationA = '44444444-4444-4444-8444-444444444444';
  const conversationB = '55555555-5555-4555-8555-555555555555';

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    await applyMigrations(pool);
    await pool.query(`INSERT INTO tenants (id, key, name) VALUES
      ($1, 'outbound-a', 'Outbound A'), ($2, 'outbound-b', 'Outbound B')`, [tenantA, tenantB]);
    await pool.query(`INSERT INTO users (id, email, name, status, updated_at)
      VALUES ($1, 'sender@example.com', 'Sender', 'ACTIVE', NOW())`, [userA]);
    await pool.query(`INSERT INTO conversations
      (id, tenant_id, channel, external_conversation_id, participant_id, last_message_at, updated_at)
      VALUES ($1, $2, 'INSTAGRAM', 'customer-a', 'customer-a', NOW(), NOW()),
             ($3, $4, 'INSTAGRAM', 'customer-b', 'customer-b', NOW(), NOW())`,
    [conversationA, tenantA, conversationB, tenantB]);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('stores a local outbound message without a webhook event', async () => {
    const id = randomUUID();
    const key = randomUUID();
    const result = await pool.query(`INSERT INTO messages
      (id, tenant_id, conversation_id, raw_event_id, channel, external_message_id, direction,
       sender_id, text, source_timestamp, client_idempotency_key, sent_by_user_id,
       delivery_status, next_delivery_attempt_at)
      VALUES ($1, $2, $3, NULL, 'INSTAGRAM', $4, 'OUTBOUND', 'shop', 'Вітаю', NOW(), $5, $6, 'PENDING', NOW())
      RETURNING raw_event_id, delivery_status, delivery_attempts, sent_by_user_id`,
    [id, tenantA, conversationA, `local:${id}`, key, userA]);

    expect(result.rows[0]).toEqual({
      raw_event_id: null,
      delivery_status: 'PENDING',
      delivery_attempts: 0,
      sent_by_user_id: userA,
    });
  });

  it('deduplicates a client key inside one tenant but not across tenants', async () => {
    const key = randomUUID();
    const insert = (tenantId: string, conversationId: string) => {
      const id = randomUUID();
      return pool.query(`INSERT INTO messages
        (id, tenant_id, conversation_id, raw_event_id, channel, external_message_id, direction,
         sender_id, text, source_timestamp, client_idempotency_key, delivery_status)
        VALUES ($1, $2, $3, NULL, 'INSTAGRAM', $4, 'OUTBOUND', 'shop', 'Text', NOW(), $5, 'PENDING')`,
      [id, tenantId, conversationId, `local:${id}`, key]);
    };

    await insert(tenantA, conversationA);
    await expect(insert(tenantA, conversationA)).rejects.toMatchObject({ code: '23505' });
    await expect(insert(tenantB, conversationB)).resolves.toMatchObject({ rowCount: 1 });
  });

  it('rejects a local message without an idempotency key', async () => {
    const id = randomUUID();
    await expect(pool.query(`INSERT INTO messages
      (id, tenant_id, conversation_id, raw_event_id, channel, external_message_id, direction,
       sender_id, text, source_timestamp)
      VALUES ($1, $2, $3, NULL, 'INSTAGRAM', $4, 'OUTBOUND', 'shop', 'Text', NOW())`,
    [id, tenantA, conversationA, `local:${id}`])).rejects.toMatchObject({ code: '23514' });
  });
});

async function applyMigrations(pool: pg.Pool): Promise<void> {
  const directory = resolve(fileURLToPath(new URL('../prisma/migrations', import.meta.url)));
  for (const name of (await readdir(directory)).sort()) {
    if (name === 'migration_lock.toml') continue;
    await pool.query(await readFile(resolve(directory, name, 'migration.sql'), 'utf8'));
  }
}
