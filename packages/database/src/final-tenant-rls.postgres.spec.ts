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

describe('remaining tenant-owned row-level security', () => {
  let container: StartedPostgreSqlContainer;
  let admin: pg.Pool;
  let api: PrismaClient;
  let worker: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    admin = new pg.Pool({ connectionString: container.getConnectionUri() });
    await applyMigrations(admin);
    await seedTenantGraph(admin, tenantA, 'a');
    await seedTenantGraph(admin, tenantB, 'b');
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

  it('fails closed without tenant context and exposes only selected-tenant rows', async () => {
    for (const client of [api, worker]) {
      await expect(client.auditLog.findMany()).resolves.toEqual([]);
      await expect(client.inventoryReservation.findMany()).resolves.toEqual([]);
      await expect(client.orderExport.findMany()).resolves.toEqual([]);
      await expect(client.orderIntentEvaluation.findMany()).resolves.toEqual([]);
    }

    await expect(withTenantTransaction(api, tenantA, async (tx) => ({
      audits: await tx.auditLog.count(),
      reservations: await tx.inventoryReservation.count(),
      exports: await tx.orderExport.count(),
      evaluations: await tx.orderIntentEvaluation.count(),
    }))).resolves.toEqual({ audits: 1, reservations: 1, exports: 1, evaluations: 1 });
  });

  it('forces RLS on every current public table containing tenant_id', async () => {
    const result = await admin.query<{ table_name: string }>(`
      SELECT tenant_column.table_name
      FROM information_schema.columns AS tenant_column
      JOIN pg_catalog.pg_class AS relation ON relation.relname = tenant_column.table_name
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE tenant_column.table_schema = 'public'
        AND tenant_column.column_name = 'tenant_id'
        AND namespace.nspname = 'public'
        AND relation.relkind = 'r'
        AND (NOT relation.relrowsecurity OR NOT relation.relforcerowsecurity)
      ORDER BY tenant_column.table_name
    `);

    expect(result.rows).toEqual([]);
  });

  it('rejects cross-tenant updates for all four tables', async () => {
    await expect(withTenantTransaction(api, tenantA, (tx) => tx.auditLog.updateMany({
      where: { tenantId: tenantB }, data: { action: 'FORBIDDEN' },
    }))).resolves.toEqual({ count: 0 });
    await expect(withTenantTransaction(api, tenantA, (tx) => tx.inventoryReservation.updateMany({
      where: { tenantId: tenantB }, data: { quantity: 99 },
    }))).resolves.toEqual({ count: 0 });
    await expect(withTenantTransaction(api, tenantA, (tx) => tx.orderExport.updateMany({
      where: { tenantId: tenantB }, data: { status: 'FAILED' },
    }))).resolves.toEqual({ count: 0 });
    await expect(withTenantTransaction(api, tenantA, (tx) => tx.orderIntentEvaluation.updateMany({
      where: { tenantId: tenantB }, data: { status: 'FAILED' },
    }))).resolves.toEqual({ count: 0 });
  });

  it('gives only the worker a bounded pending-export directory', async () => {
    await expect(worker.$queryRaw`
      SELECT tenant_id, export_id FROM public.worker_due_order_exports(${1})
    `).resolves.toEqual([{ tenant_id: tenantA, export_id: expect.any(String) }]);
    await expect(api.$queryRaw`
      SELECT * FROM public.worker_due_order_exports(${50})
    `).rejects.toMatchObject({ code: 'P2010' });
  });
});

async function seedTenantGraph(pool: pg.Pool, tenantId: string, suffix: string): Promise<void> {
  const conversationId = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  const orderId = crypto.randomUUID();
  const orderItemId = crypto.randomUUID();
  const productId = crypto.randomUUID();
  const destinationId = crypto.randomUUID();
  await pool.query('INSERT INTO tenants (id, key, name) VALUES ($1, $2, $3)', [tenantId, `tenant-${suffix}`, `Fictional ${suffix}`]);
  await pool.query(`INSERT INTO conversations
    (id, tenant_id, channel, external_conversation_id, participant_id, last_message_at, updated_at)
    VALUES ($1, $2, 'INSTAGRAM', $3, $3, NOW(), NOW())`, [conversationId, tenantId, `conversation-${suffix}`]);
  await pool.query(`INSERT INTO messages
    (id, tenant_id, conversation_id, channel, external_message_id, direction, sender_id, text,
     source_timestamp, client_idempotency_key)
    VALUES ($1, $2, $3, 'INSTAGRAM', $4, 'INBOUND', 'customer', 'Fictional order',
            NOW(), $1)`, [messageId, tenantId, conversationId, `message-${suffix}`]);
  await pool.query(`INSERT INTO orders
    (id, tenant_id, conversation_id, trigger_message_id, status, prompt_version, updated_at)
    VALUES ($1, $2, $3, $4, 'APPROVED', 'instagram-order-v2', NOW())`, [orderId, tenantId, conversationId, messageId]);
  await pool.query(`INSERT INTO order_items
    (id, tenant_id, order_id, original_text, quantity, confidence)
    VALUES ($1, $2, $3, 'Fictional item', 1, 0.95)`, [orderItemId, tenantId, orderId]);
  await pool.query(`INSERT INTO products
    (id, tenant_id, sku, name, aliases, stock_quantity, updated_at)
    VALUES ($1, $2, $3, 'Fictional product', '[]', 10, NOW())`, [productId, tenantId, `SKU-${suffix}`]);
  await pool.query(`INSERT INTO inventory_reservations
    (tenant_id, product_id, order_item_id, quantity, updated_at)
    VALUES ($1, $2, $3, 1, NOW())`, [tenantId, productId, orderItemId]);
  await pool.query(`INSERT INTO audit_logs
    (id, tenant_id, order_id, actor, action, changes)
    VALUES ($1, $2, $3, 'SYSTEM', 'FICTIONAL', '{}')`, [crypto.randomUUID(), tenantId, orderId]);
  await pool.query(`INSERT INTO google_sheets_destinations
    (id, tenant_id, spreadsheet_id, sheet_name, required_headers, status, updated_at)
    VALUES ($1, $2, $3, 'Orders', '[]', 'ACTIVE', NOW())`, [destinationId, tenantId, `sheet-${suffix}`]);
  await pool.query(`INSERT INTO order_exports
    (id, tenant_id, order_id, destination_id, status, updated_at)
    VALUES ($1, $2, $3, $4, 'PENDING', NOW())`, [crypto.randomUUID(), tenantId, orderId, destinationId]);
  await pool.query(`INSERT INTO order_intent_evaluations
    (tenant_id, conversation_id, anchor_message_id, mode, status)
    VALUES ($1, $2, $3, 'REVIEW', 'IGNORED')`, [tenantId, conversationId, messageId]);
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
