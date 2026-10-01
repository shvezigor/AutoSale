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
const orderA = '33333333-3333-4333-8333-333333333333';
const orderB = '44444444-4444-4444-8444-444444444444';
const itemA = '55555555-5555-4555-8555-555555555555';
const itemB = '66666666-6666-4666-8666-666666666666';

describe('order item row-level security', () => {
  let container: StartedPostgreSqlContainer;
  let admin: pg.Pool;
  let prisma: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    admin = new pg.Pool({ connectionString: container.getConnectionUri() });
    await applyMigrations(admin);
    await seedOrderItem(admin, tenantA, orderA, itemA, 'item-a');
    await seedOrderItem(admin, tenantB, orderB, itemB, 'item-b');
    await configureRuntimeDatabaseRoles(container.getConnectionUri(), { apiPassword, workerPassword, backupPassword });
    prisma = createPrismaClient(runtimeUrl(container.getConnectionUri(), 'autosale_api', apiPassword));
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await admin?.end();
    await container?.stop();
  });

  it('hides items without context and exposes only the selected tenant', async () => {
    await expect(prisma.orderItem.findMany()).resolves.toEqual([]);

    await expect(withTenantTransaction(prisma, tenantA, (tx) => tx.orderItem.findMany({
      select: { id: true, tenantId: true },
    }))).resolves.toEqual([{ id: itemA, tenantId: tenantA }]);
  });

  it('rejects updates to another tenant order item', async () => {
    await expect(withTenantTransaction(prisma, tenantA, (tx) => tx.orderItem.update({
      where: { id: itemB },
      data: { quantity: 99 },
    }))).rejects.toMatchObject({ code: 'P2025' });
  });
});

async function seedOrderItem(
  pool: pg.Pool,
  tenantId: string,
  orderId: string,
  itemId: string,
  suffix: string,
): Promise<void> {
  const conversationId = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  await pool.query('INSERT INTO tenants (id, key, name) VALUES ($1, $2, $3)', [tenantId, suffix, `Fictional ${suffix}`]);
  await pool.query(`INSERT INTO users (id, email, name, status, updated_at)
    VALUES ($1, $2, $3, 'ACTIVE', NOW())`, [userId, `${suffix}@example.invalid`, `User ${suffix}`]);
  await pool.query(`INSERT INTO conversations
    (id, tenant_id, channel, external_conversation_id, participant_id, last_message_at, updated_at)
    VALUES ($1, $2, 'INSTAGRAM', $3, $3, NOW(), NOW())`, [conversationId, tenantId, suffix]);
  await pool.query(`INSERT INTO messages
    (id, tenant_id, conversation_id, channel, external_message_id, direction, sender_id, text,
     source_timestamp, client_idempotency_key, sent_by_user_id, delivery_status, next_delivery_attempt_at)
    VALUES ($1, $2, $3, 'INSTAGRAM', $4, 'OUTBOUND', 'manager', 'Fictional order item',
            NOW(), $1, $5, 'SENT', NOW())`, [messageId, tenantId, conversationId, `${suffix}-message`, userId]);
  await pool.query(`INSERT INTO orders
    (id, tenant_id, conversation_id, trigger_message_id, status, prompt_version, updated_at)
    VALUES ($1, $2, $3, $4, 'APPROVED', 'instagram-order-v2', NOW())`, [orderId, tenantId, conversationId, messageId]);
  await pool.query(`INSERT INTO order_items
    (id, tenant_id, order_id, original_text, quantity, confidence)
    VALUES ($1, $2, $3, $4, 1, 0.95)`, [itemId, tenantId, orderId, `Fictional ${suffix}`]);
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
