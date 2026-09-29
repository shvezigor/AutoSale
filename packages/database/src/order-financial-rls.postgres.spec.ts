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
const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const userA = '33333333-3333-4333-8333-333333333333';
const userB = '44444444-4444-4444-8444-444444444444';
const orderA = '55555555-5555-4555-8555-555555555555';
const orderB = '66666666-6666-4666-8666-666666666666';
const termsA = '77777777-7777-4777-8777-777777777777';
const termsB = '88888888-8888-4888-8888-888888888888';
const paymentA = '99999999-9999-4999-8999-999999999999';
const paymentB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('order financial row-level security', () => {
  let container: StartedPostgreSqlContainer;
  let admin: pg.Pool;
  let prisma: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    admin = new pg.Pool({ connectionString: container.getConnectionUri() });
    await applyMigrations(admin);
    await seedOrder(admin, tenantA, userA, orderA, termsA, paymentA, 'financial-a');
    await seedOrder(admin, tenantB, userB, orderB, termsB, paymentB, 'financial-b');
    await configureRuntimeDatabaseRoles(container.getConnectionUri(), { apiPassword, workerPassword });
    prisma = createPrismaClient(runtimeUrl(container.getConnectionUri(), 'autosale_api', apiPassword));
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await admin?.end();
    await container?.stop();
  });

  it('hides commercial terms and payments without context and exposes only the selected tenant', async () => {
    await expect(prisma.orderCommercialTerms.findMany()).resolves.toEqual([]);
    await expect(prisma.orderPayment.findMany()).resolves.toEqual([]);

    await expect(withTenantTransaction(prisma, tenantA, async (tx) => ({
      terms: await tx.orderCommercialTerms.findMany({ select: { tenantId: true } }),
      payments: await tx.orderPayment.findMany({ select: { tenantId: true } }),
    }))).resolves.toEqual({
      terms: [{ tenantId: tenantA }],
      payments: [{ tenantId: tenantA }],
    });
  });

  it('rejects updates to another tenant financial records', async () => {
    await expect(withTenantTransaction(prisma, tenantA, (tx) => tx.orderCommercialTerms.update({
      where: { id: termsB },
      data: { updatedBy: 'blocked-update' },
    }))).rejects.toMatchObject({ code: 'P2025' });

    await expect(withTenantTransaction(prisma, tenantA, (tx) => tx.orderPayment.update({
      where: { id: paymentB },
      data: { note: 'blocked-update' },
    }))).rejects.toMatchObject({ code: 'P2025' });
  });
});

async function seedOrder(
  pool: pg.Pool,
  tenantId: string,
  userId: string,
  orderId: string,
  termsId: string,
  paymentId: string,
  suffix: string,
): Promise<void> {
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
    VALUES ($1, $2, $3, 'INSTAGRAM', $4, 'OUTBOUND', 'manager', 'Fictional financial record',
            NOW(), $1, $5, 'SENT', NOW())`, [messageId, tenantId, conversationId, `${suffix}-message`, userId]);
  await pool.query(`INSERT INTO orders
    (id, tenant_id, conversation_id, trigger_message_id, status, prompt_version, updated_at)
    VALUES ($1, $2, $3, $4, 'APPROVED', 'instagram-order-v2', NOW())`, [orderId, tenantId, conversationId, messageId]);
  await pool.query(`INSERT INTO order_commercial_terms
    (id, tenant_id, order_id, currency, items_subtotal, total_amount, pricing_status, issue_codes, updated_by, updated_at)
    VALUES ($1, $2, $3, 'UAH', 125, 125, 'READY', '[]'::jsonb, 'SYSTEM', NOW())`, [termsId, tenantId, orderId]);
  await pool.query(`INSERT INTO order_payments
    (id, tenant_id, order_id, amount, currency, method, received_at, created_by, idempotency_key, request_hash)
    VALUES ($1, $2, $3, 125, 'UAH', 'CASH', NOW(), $4, $5, 'fictional-request-hash')`,
  [paymentId, tenantId, orderId, userId, crypto.randomUUID()]);
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
