import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const conversationA = '33333333-3333-4333-8333-333333333333';
const conversationB = '44444444-4444-4444-8444-444444444444';
const eventA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const eventB = '55555555-5555-4555-8555-555555555555';
const messageA = '66666666-6666-4666-8666-666666666666';
const messageB = '77777777-7777-4777-8777-777777777777';
const messageB2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const orderA = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const orderB = '88888888-8888-4888-8888-888888888888';
const entityB = '99999999-9999-4999-8999-999999999999';
const accountB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const destinationB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('tenant-owned database relations', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    await applyMigrations(pool);
    await seedTenants(pool);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it.each([
    ['message to conversation', () => pool.query(`INSERT INTO messages
      (id, tenant_id, conversation_id, raw_event_id, channel, external_message_id, direction, sender_id, source_timestamp)
      VALUES (gen_random_uuid(), $1, $2, $3, 'INSTAGRAM', 'cross-message', 'INBOUND', 'customer', NOW())`,
    [tenantA, conversationB, eventB])],
    ['order to conversation and trigger message', () => pool.query(`INSERT INTO orders
      (id, tenant_id, conversation_id, trigger_message_id, status, prompt_version, updated_at)
      VALUES (gen_random_uuid(), $1, $2, $3, 'AI_PROCESSING', 'tenant-isolation-test', NOW())`,
    [tenantA, conversationB, messageB2])],
    ['bank account to legal entity', () => pool.query(`INSERT INTO tenant_bank_accounts
      (id, tenant_id, legal_entity_id, label, iban, normalized_iban, currency, updated_at)
      VALUES (gen_random_uuid(), $1, $2, 'Fictional account', 'UA000000000000000000000000001',
              'UA000000000000000000000000001', 'UAH', NOW())`, [tenantA, entityB])],
    ['commercial terms to order and payment account', () => pool.query(`INSERT INTO order_commercial_terms
      (id, tenant_id, order_id, bank_account_id, pricing_status, issue_codes, updated_by, updated_at)
      VALUES (gen_random_uuid(), $1, $2, $3, 'READY', '[]'::jsonb, 'tenant-isolation-test', NOW())`,
    [tenantA, orderA, accountB])],
    ['export to order and destination', () => pool.query(`INSERT INTO order_exports
      (id, tenant_id, order_id, destination_id, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, NOW())`,
    [tenantA, orderB, destinationB])],
    ['audit event to order', () => pool.query(`INSERT INTO audit_logs
      (id, tenant_id, order_id, actor, action, changes)
      VALUES (gen_random_uuid(), $1, $2, 'test', 'TEST', '{}'::jsonb)`,
    [tenantA, orderB])],
  ])('rejects a cross-tenant %s relation', async (_label, insert) => {
    await expect(insert()).rejects.toMatchObject({ code: '23503' });
  });
});

async function seedTenants(pool: pg.Pool): Promise<void> {
  await pool.query(`INSERT INTO tenants (id, key, name) VALUES
    ($1, 'tenant-a', 'Fictional Tenant A'), ($2, 'tenant-b', 'Fictional Tenant B')`, [tenantA, tenantB]);
  await pool.query(`INSERT INTO conversations
    (id, tenant_id, channel, external_conversation_id, participant_id, last_message_at, updated_at)
    VALUES ($1, $2, 'INSTAGRAM', 'conversation-a', 'customer-a', NOW(), NOW()),
           ($3, $4, 'INSTAGRAM', 'conversation-b', 'customer-b', NOW(), NOW())`,
  [conversationA, tenantA, conversationB, tenantB]);
  await pool.query(`INSERT INTO webhook_events
    (id, tenant_id, provider, external_event_id, payload)
    VALUES ($1, $2, 'META', 'event-a', '{}'::jsonb),
           ($3, $4, 'META', 'event-b', '{}'::jsonb)`, [eventA, tenantA, eventB, tenantB]);
  await pool.query(`INSERT INTO messages
    (id, tenant_id, conversation_id, raw_event_id, channel, external_message_id, direction, sender_id, source_timestamp)
    VALUES ($1, $2, $3, $4, 'INSTAGRAM', 'message-a', 'INBOUND', 'customer-a', NOW()),
           ($5, $6, $7, $8, 'INSTAGRAM', 'message-b', 'INBOUND', 'customer-b', NOW()),
           ($9, $6, $7, $8, 'INSTAGRAM', 'message-b-2', 'INBOUND', 'customer-b', NOW())`,
  [messageA, tenantA, conversationA, eventA, messageB, tenantB, conversationB, eventB, messageB2]);
  await pool.query(`INSERT INTO orders
    (id, tenant_id, conversation_id, trigger_message_id, status, prompt_version, updated_at)
    VALUES ($1, $2, $3, $4, 'APPROVED', 'tenant-isolation-test', NOW()),
           ($5, $6, $7, $8, 'APPROVED', 'tenant-isolation-test', NOW())`,
  [orderA, tenantA, conversationA, messageA, orderB, tenantB, conversationB, messageB]);
  await pool.query(`INSERT INTO tenant_legal_entities
    (id, tenant_id, display_name, legal_name, type, updated_at)
    VALUES ($1, $2, 'Entity B', 'Fictional Entity B', 'SOLE_PROPRIETOR', NOW())`, [entityB, tenantB]);
  await pool.query(`INSERT INTO tenant_bank_accounts
    (id, tenant_id, legal_entity_id, label, iban, normalized_iban, currency, updated_at)
    VALUES ($1, $2, $3, 'Account B', 'UA000000000000000000000000002',
            'UA000000000000000000000000002', 'UAH', NOW())`, [accountB, tenantB, entityB]);
  await pool.query(`INSERT INTO google_sheets_destinations
    (id, tenant_id, spreadsheet_id, sheet_name, required_headers, updated_at)
    VALUES ($1, $2, 'fictional-sheet-b', 'Orders', '[]'::jsonb, NOW())`, [destinationB, tenantB]);
}

async function applyMigrations(pool: pg.Pool): Promise<void> {
  const root = resolve(fileURLToPath(new URL('../prisma/migrations', import.meta.url)));
  for (const name of (await readdir(root)).sort()) {
    if (name === 'migration_lock.toml') continue;
    await pool.query(await readFile(resolve(root, name, 'migration.sql'), 'utf8'));
  }
}
