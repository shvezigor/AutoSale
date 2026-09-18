import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('order intent evaluation migration', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    const root = resolve(process.cwd(), '../../packages/database/prisma/migrations');
    for (const migration of (await readdir(root)).sort()) {
      if (migration === 'migration_lock.toml') continue;
      await pool.query(await readFile(resolve(root, migration, 'migration.sql'), 'utf8'));
    }
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('stores one durable evaluation per anchor message', async () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const conversationId = '22222222-2222-4222-8222-222222222222';
    const messageId = '33333333-3333-4333-8333-333333333333';
    const eventId = '44444444-4444-4444-8444-444444444444';
    await pool.query('INSERT INTO "tenants" ("id", "key", "name") VALUES ($1, $2, $3)', [tenantId, 'intent-test', 'Intent test']);
    await pool.query('INSERT INTO "webhook_events" ("id", "tenant_id", "provider", "external_event_id", "payload") VALUES ($1, $2, $3, $4, $5::jsonb)', [eventId, tenantId, 'META', 'intent-event', '{}']);
    await pool.query('INSERT INTO "conversations" ("id", "tenant_id", "channel", "external_conversation_id", "participant_id", "last_message_at", "created_at", "updated_at") VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), NOW())', [conversationId, tenantId, 'INSTAGRAM', 'intent-customer', 'intent-customer']);
    await pool.query('INSERT INTO "messages" ("id", "tenant_id", "conversation_id", "raw_event_id", "channel", "external_message_id", "direction", "sender_id", "source_timestamp", "created_at") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())', [messageId, tenantId, conversationId, eventId, 'INSTAGRAM', 'intent-message', 'INBOUND', 'customer']);

    await pool.query('INSERT INTO "order_intent_evaluations" ("tenant_id", "conversation_id", "anchor_message_id", "mode", "status") VALUES ($1, $2, $3, $4, $5)', [tenantId, conversationId, messageId, 'AI_SUGGESTION', 'PROCESSING']);

    await expect(pool.query('INSERT INTO "order_intent_evaluations" ("tenant_id", "conversation_id", "anchor_message_id", "mode", "status") VALUES ($1, $2, $3, $4, $5)', [tenantId, conversationId, messageId, 'AI_SUGGESTION', 'PROCESSING'])).rejects.toMatchObject({ code: '23505' });
  });
});
