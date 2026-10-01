import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from './client.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { configureRuntimeDatabaseRoles } from './runtime-database-roles.js';
import { withTenantTransaction } from './tenant-transaction.js';

const apiPassword = 'fictional-api-password-32-characters';
const workerPassword = 'fictional-worker-password-32-chars';
const backupPassword = 'fictional-backup-password-32-chars';
const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const conversationA = '33333333-3333-4333-8333-333333333333';
const conversationB = '44444444-4444-4444-8444-444444444444';
const messageA = '55555555-5555-4555-8555-555555555555';
const messageB = '66666666-6666-4666-8666-666666666666';
const backfillMessageA = '77777777-7777-4777-8777-777777777777';
const backfillMessageB = '88888888-8888-4888-8888-888888888888';
const eventA = '99999999-9999-4999-8999-999999999999';
const eventB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('conversation and message row-level security', () => {
  let container: StartedPostgreSqlContainer;
  let admin: pg.Pool;
  let api: PrismaClient;
  let worker: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    admin = new pg.Pool({ connectionString: container.getConnectionUri() });
    await applyMigrations(admin);
    await seedConversation(admin, tenantA, conversationA, messageA, 'conversation-a');
    await seedConversation(admin, tenantB, conversationB, messageB, 'conversation-b');
    await configureRuntimeDatabaseRoles(container.getConnectionUri(), { apiPassword, workerPassword, backupPassword });
    api = createPrismaClient(runtimeUrl(container.getConnectionUri(), 'autosale_api', apiPassword));
    worker = createPrismaClient(runtimeUrl(container.getConnectionUri(), 'autosale_worker', workerPassword));
  }, 60_000);

  afterAll(async () => {
    await api?.$disconnect();
    await worker?.$disconnect();
    await admin?.end();
    await container?.stop();
  });

  it('hides conversations and messages without context and exposes only the selected tenant', async () => {
    await expect(api.conversation.findMany()).resolves.toEqual([]);
    await expect(api.message.findMany()).resolves.toEqual([]);

    await expect(withTenantTransaction(api, tenantA, (tx) => tx.conversation.findMany({
      select: { id: true, tenantId: true },
    }))).resolves.toEqual([{ id: conversationA, tenantId: tenantA }]);
    await expect(withTenantTransaction(api, tenantA, (tx) => tx.message.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, tenantId: true },
    }))).resolves.toEqual([
      { id: messageA, tenantId: tenantA },
      { id: backfillMessageA, tenantId: tenantA },
    ]);
  });

  it('rejects cross-tenant conversation and message updates', async () => {
    await expect(withTenantTransaction(api, tenantA, (tx) => tx.conversation.update({
      where: { id: conversationB },
      data: { displayName: 'Forbidden' },
    }))).rejects.toMatchObject({ code: 'P2025' });
    await expect(withTenantTransaction(api, tenantA, (tx) => tx.message.update({
      where: { id: messageB },
      data: { text: 'Forbidden' },
    }))).rejects.toMatchObject({ code: 'P2025' });
  });

  it('allows only the worker to discover due message IDs without exposing message content', async () => {
    const due = await worker.$queryRaw<Array<{ tenant_id: string; message_id: string }>>`
      SELECT tenant_id, message_id
      FROM public.worker_due_instagram_messages(${new Date('2099-01-01T00:00:00.000Z')}, 50)
      ORDER BY tenant_id
    `;
    expect(due).toEqual([
      { tenant_id: tenantA, message_id: messageA },
      { tenant_id: tenantB, message_id: messageB },
    ]);

    await expect(api.$queryRaw`
      SELECT tenant_id, message_id
      FROM public.worker_due_instagram_messages(${new Date('2099-01-01T00:00:00.000Z')}, 50)
    `).rejects.toMatchObject({ code: 'P2010' });
  });

  it('allows only the worker to discover attachment-recovery event IDs without message content', async () => {
    const events = await worker.$queryRaw<Array<{ event_id: string }>>`
      SELECT event_id
      FROM public.worker_instagram_attachment_backfill_events(100)
      ORDER BY event_id
    `;
    expect(events).toEqual([{ event_id: eventA }, { event_id: eventB }]);

    await expect(api.$queryRaw`
      SELECT event_id FROM public.worker_instagram_attachment_backfill_events(100)
    `).rejects.toMatchObject({ code: 'P2010' });
  });
});

async function seedConversation(
  pool: pg.Pool,
  tenantId: string,
  conversationId: string,
  messageId: string,
  suffix: string,
): Promise<void> {
  const userId = crypto.randomUUID();
  const eventId = tenantId === tenantA ? eventA : eventB;
  const backfillMessageId = tenantId === tenantA ? backfillMessageA : backfillMessageB;
  await pool.query('INSERT INTO tenants (id, key, name) VALUES ($1, $2, $3)', [tenantId, suffix, `Fictional ${suffix}`]);
  await pool.query(`INSERT INTO users (id, email, name, status, updated_at)
    VALUES ($1, $2, $3, 'ACTIVE', NOW())`, [userId, `${suffix}@example.invalid`, `User ${suffix}`]);
  await pool.query(`INSERT INTO conversations
    (id, tenant_id, channel, external_conversation_id, participant_id, last_message_at, updated_at)
    VALUES ($1, $2, 'INSTAGRAM', $3, $3, NOW(), NOW())`, [conversationId, tenantId, suffix]);
  await pool.query(`INSERT INTO webhook_events
    (id, tenant_id, provider, external_event_id, payload, status)
    VALUES ($1, $2, 'META', $3, '{}'::jsonb, 'PROCESSED')`, [eventId, tenantId, `${suffix}-event`]);
  await pool.query(`INSERT INTO messages
    (id, tenant_id, conversation_id, channel, external_message_id, direction, sender_id, text,
     source_timestamp, client_idempotency_key, sent_by_user_id, delivery_status, next_delivery_attempt_at)
    VALUES ($1, $2, $3, 'INSTAGRAM', $4, 'OUTBOUND', 'manager', 'Fictional message',
            NOW(), $1, $5, 'PENDING', NOW())`, [messageId, tenantId, conversationId, `${suffix}-message`, userId]);
  await pool.query(`INSERT INTO messages
    (id, tenant_id, conversation_id, raw_event_id, channel, external_message_id, direction, sender_id, text,
     source_timestamp)
    VALUES ($1, $2, $3, $4, 'INSTAGRAM', $5, 'INBOUND', 'customer', NULL, NOW())`,
  [backfillMessageId, tenantId, conversationId, eventId, `${suffix}-backfill`]);
}

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
