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
const conversationA = '55555555-5555-4555-8555-555555555555';
const conversationB = '66666666-6666-4666-8666-666666666666';
const messageA = '77777777-7777-4777-8777-777777777777';
const messageB = '88888888-8888-4888-8888-888888888888';
const orderA = '99999999-9999-4999-8999-999999999999';
const orderB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const itemA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const itemB = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const productA = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const deliveryA = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

describe('procurement persistence constraints', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    await applyMigrations(pool);
    await seedOrders(pool);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('allows only one inventory reservation for an order item', async () => {
    await pool.query(`INSERT INTO inventory_reservations
      (tenant_id, product_id, order_item_id, quantity, status, updated_at)
      VALUES ($1, $2, $3, 1, 'ACTIVE', NOW())`, [tenantA, productA, itemA]);

    await expect(pool.query(`INSERT INTO inventory_reservations
      (tenant_id, product_id, order_item_id, quantity, status, updated_at)
      VALUES ($1, $2, $3, 1, 'ACTIVE', NOW())`, [tenantA, productA, itemA]))
      .rejects.toMatchObject({ code: '23505' });
  });

  it('rejects a Telegram delivery item from another tenant', async () => {
    await expect(pool.query(`INSERT INTO telegram_delivery_items
      (tenant_id, delivery_id, order_item_id)
      VALUES ($1, $2, $3)`, [tenantA, deliveryA, itemB]))
      .rejects.toMatchObject({ code: '23503' });
  });

  it('stores one preference per tenant, user and event type', async () => {
    await pool.query(`INSERT INTO telegram_notification_preferences
      (tenant_id, user_id, event_type, enabled, updated_at)
      VALUES ($1, $2, 'ORDER_NEEDS_REVIEW', TRUE, NOW())`, [tenantA, userA]);

    await expect(pool.query(`INSERT INTO telegram_notification_preferences
      (tenant_id, user_id, event_type, enabled, updated_at)
      VALUES ($1, $2, 'ORDER_NEEDS_REVIEW', FALSE, NOW())`, [tenantA, userA]))
      .rejects.toMatchObject({ code: '23505' });
  });
});

async function seedOrders(pool: pg.Pool): Promise<void> {
  await pool.query(`INSERT INTO tenants (id, key, name) VALUES
    ($1, 'procurement-a', 'Procurement A'), ($2, 'procurement-b', 'Procurement B')`, [tenantA, tenantB]);
  await pool.query(`INSERT INTO users (id, email, name, status, updated_at) VALUES
    ($1, 'procurement-a@example.com', 'User A', 'ACTIVE', NOW()),
    ($2, 'procurement-b@example.com', 'User B', 'ACTIVE', NOW())`, [userA, userB]);
  await pool.query(`INSERT INTO conversations
    (id, tenant_id, channel, external_conversation_id, participant_id, last_message_at, updated_at) VALUES
    ($1, $2, 'INSTAGRAM', 'procurement-a', 'procurement-a', NOW(), NOW()),
    ($3, $4, 'INSTAGRAM', 'procurement-b', 'procurement-b', NOW(), NOW())`,
  [conversationA, tenantA, conversationB, tenantB]);
  await pool.query(`INSERT INTO messages
    (id, tenant_id, conversation_id, channel, external_message_id, direction, sender_id, text,
     source_timestamp, client_idempotency_key, delivery_status) VALUES
    ($1, $2, $3, 'INSTAGRAM', 'procurement-message-a', 'OUTBOUND', 'shop', 'Order A', NOW(),
     '11111111-aaaa-4111-8111-111111111111', 'SENT'),
    ($4, $5, $6, 'INSTAGRAM', 'procurement-message-b', 'OUTBOUND', 'shop', 'Order B', NOW(),
     '22222222-bbbb-4222-8222-222222222222', 'SENT')`,
  [messageA, tenantA, conversationA, messageB, tenantB, conversationB]);
  await pool.query(`INSERT INTO orders
    (id, tenant_id, conversation_id, trigger_message_id, status, prompt_version, updated_at) VALUES
    ($1, $2, $3, $4, 'APPROVED', 'test', NOW()),
    ($5, $6, $7, $8, 'APPROVED', 'test', NOW())`,
  [orderA, tenantA, conversationA, messageA, orderB, tenantB, conversationB, messageB]);
  await pool.query(`INSERT INTO order_items
    (id, tenant_id, order_id, catalog_id, original_text, quantity, confidence) VALUES
    ($1, $2, $3, 'SKU-A', 'Product A', 1, 1),
    ($4, $5, $6, 'SKU-B', 'Product B', 1, 1)`, [itemA, tenantA, orderA, itemB, tenantB, orderB]);
  await pool.query(`INSERT INTO products
    (id, tenant_id, sku, name, aliases, stock_quantity, updated_at)
    VALUES ($1, $2, 'SKU-A', 'Product A', '[]', 5, NOW())`, [productA, tenantA]);
  const chat = await pool.query(`INSERT INTO telegram_chats
    (tenant_id, external_chat_id, type, title, route, last_observed_at, updated_at)
    VALUES ($1, '-100-procurement', 'group', 'Supplier', 'BOT', NOW(), NOW()) RETURNING id`, [tenantA]);
  await pool.query(`INSERT INTO telegram_deliveries
    (id, tenant_id, destination_id, purpose, status, idempotency_key, message_text, next_attempt_at, updated_at)
    VALUES ($1, $2, $3, 'SUPPLIER_ORDER', 'PENDING', 'procurement:test', 'Test', NOW(), NOW())`,
  [deliveryA, tenantA, chat.rows[0]?.id]);
}

async function applyMigrations(pool: pg.Pool): Promise<void> {
  const directory = resolve(fileURLToPath(new URL('../prisma/migrations', import.meta.url)));
  for (const name of (await readdir(directory)).sort()) {
    if (name === 'migration_lock.toml') continue;
    await pool.query(await readFile(resolve(directory, name, 'migration.sql'), 'utf8'));
  }
}
