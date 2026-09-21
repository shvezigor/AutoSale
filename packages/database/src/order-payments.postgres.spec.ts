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
const orderA = '55555555-5555-4555-8555-555555555555';
const orderB = '66666666-6666-4666-8666-666666666666';

describe('order payment persistence', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    await applyMigrations(pool);
    await seedOrder(pool, tenantA, userA, orderA, 'payment-a');
    await seedOrder(pool, tenantB, userB, orderB, 'payment-b');
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('keeps create idempotency tenant-scoped', async () => {
    const key = '77777777-7777-4777-8777-777777777777';
    await expect(insertPayment(pool, tenantA, orderA, userA, key)).resolves.toBeTypeOf('string');
    await expect(insertPayment(pool, tenantA, orderA, userA, key)).rejects.toMatchObject({ code: '23505' });
    await expect(insertPayment(pool, tenantB, orderB, userB, key)).resolves.toBeTypeOf('string');
  });

  it('rejects cross-tenant order ownership', async () => {
    await expect(insertPayment(pool, tenantA, orderB, userA, '88888888-8888-4888-8888-888888888888'))
      .rejects.toMatchObject({ code: '23503' });
  });

  it('enforces positive money and complete cancellation metadata without rewriting the amount', async () => {
    await expect(pool.query(`INSERT INTO order_payments
      (tenant_id, order_id, amount, currency, method, received_at, created_by, idempotency_key, request_hash)
      VALUES ($1, $2, 0, 'UAH', 'CASH', NOW(), $3, $4, 'hash')`,
    [tenantA, orderA, userA, '99999999-9999-4999-8999-999999999999'])).rejects.toMatchObject({ code: '23514' });

    const paymentId = await insertPayment(pool, tenantA, orderA, userA, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    await expect(pool.query('UPDATE order_payments SET cancelled_at = NOW() WHERE id = $1', [paymentId]))
      .rejects.toMatchObject({ code: '23514' });
    await pool.query(`UPDATE order_payments SET cancelled_at = NOW(), cancelled_by = $2,
      cancellation_reason = 'Fictional correction', cancellation_idempotency_key = $3,
      cancellation_request_hash = 'cancel-hash' WHERE id = $1`,
    [paymentId, userA, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']);
    const result = await pool.query<{ amount: string; cancelled_at: Date | null }>('SELECT amount::text, cancelled_at FROM order_payments WHERE id = $1', [paymentId]);
    expect(result.rows[0]?.amount).toBe('125.00');
    expect(result.rows[0]?.cancelled_at).toBeInstanceOf(Date);
  });
});

async function insertPayment(pool: pg.Pool, tenantId: string, orderId: string, userId: string, key: string): Promise<string> {
  const result = await pool.query<{ id: string }>(`INSERT INTO order_payments
    (tenant_id, order_id, amount, currency, method, received_at, created_by, idempotency_key, request_hash)
    VALUES ($1, $2, 125, 'UAH', 'CASH', NOW(), $3, $4, 'request-hash') RETURNING id`,
  [tenantId, orderId, userId, key]);
  return result.rows[0]!.id;
}

async function seedOrder(pool: pg.Pool, tenantId: string, userId: string, orderId: string, suffix: string): Promise<void> {
  const conversationId = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  await pool.query('INSERT INTO tenants (id, key, name) VALUES ($1, $2, $3)', [tenantId, suffix, `Fictional ${suffix}`]);
  await pool.query(`INSERT INTO users (id, email, name, status, updated_at)
    VALUES ($1, $2, $3, 'ACTIVE', NOW())`, [userId, `${suffix}@example.invalid`, `User ${suffix}`]);
  await pool.query(`INSERT INTO conversations
    (id, tenant_id, channel, external_conversation_id, participant_id, last_message_at, updated_at)
    VALUES ($1, $2, 'INSTAGRAM', $3, $3, NOW(), NOW())`, [conversationId, tenantId, suffix]);
  await pool.query(`INSERT INTO messages
    (id, tenant_id, conversation_id, channel, external_message_id, direction, sender_id, text,
     source_timestamp, client_idempotency_key, sent_by_user_id, delivery_status, next_delivery_attempt_at)
    VALUES ($1, $2, $3, 'INSTAGRAM', $4, 'OUTBOUND', 'manager', 'Fictional payment',
            NOW(), $1, $5, 'SENT', NOW())`, [messageId, tenantId, conversationId, `${suffix}-message`, userId]);
  await pool.query(`INSERT INTO orders
    (id, tenant_id, conversation_id, trigger_message_id, status, prompt_version, updated_at)
    VALUES ($1, $2, $3, $4, 'APPROVED', 'instagram-order-v2', NOW())`, [orderId, tenantId, conversationId, messageId]);
}

async function applyMigrations(pool: pg.Pool): Promise<void> {
  const root = resolve(fileURLToPath(new URL('../prisma/migrations', import.meta.url)));
  for (const name of (await readdir(root)).sort()) {
    if (name === 'migration_lock.toml') continue;
    await pool.query(await readFile(resolve(root, name, 'migration.sql'), 'utf8'));
  }
}
