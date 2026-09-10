import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, ProcurementStore, type PrismaClient } from './index.js';

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
  let prisma: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    await applyMigrations(pool);
    await seedOrders(pool);
    prisma = createPrismaClient(container.getConnectionUri());
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
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

  it('reserves known stock and records the automatic decision', async () => {
    const fixture = await createApprovedOrder(prisma, { sku: 'STOCK-5', stock: 5, quantity: 2 });
    const store = new ProcurementStore(prisma);

    const assessment = await store.assessApprovedOrder(tenantA, fixture.orderId, userA);
    const item = await prisma.orderItem.findUniqueOrThrow({
      where: { id: fixture.itemId },
      include: { reservation: true },
    });

    expect(assessment.summary).toBe('READY');
    expect(item).toMatchObject({
      procurementStatus: 'IN_STOCK',
      procurementSource: 'AUTO',
      procurementReason: 'STOCK_AVAILABLE',
      stockAtDecision: 5,
      availableAtDecision: 5,
      reservation: { quantity: 2, status: 'ACTIVE' },
    });
  });

  it.each([
    { label: 'unknown stock', sku: 'UNKNOWN-STOCK', stock: null },
    { label: 'unknown SKU', sku: 'MISSING-SKU', stock: undefined },
  ])('marks $label for supplier ordering without a reservation', async ({ sku, stock }) => {
    const fixture = await createApprovedOrder(prisma, {
      sku,
      quantity: 1,
      ...(stock !== undefined ? { stock } : {}),
    });
    const store = new ProcurementStore(prisma);

    await store.assessApprovedOrder(tenantA, fixture.orderId, userA);
    const item = await prisma.orderItem.findUniqueOrThrow({
      where: { id: fixture.itemId },
      include: { reservation: true },
    });

    expect(item.procurementStatus).toBe('TO_ORDER');
    expect(item.reservation).toBeNull();
    expect(item.procurementReason).toBe(stock === null ? 'STOCK_UNKNOWN' : 'PRODUCT_UNMATCHED');
  });

  it('serializes competing reservations and remains idempotent on replay', async () => {
    const product = await prisma.product.create({
      data: { tenantId: tenantA, sku: 'COMPETING', name: 'Competing', aliases: [], stockQuantity: 5 },
    });
    const first = await createApprovedOrder(prisma, { sku: product.sku, quantity: 4 });
    const second = await createApprovedOrder(prisma, { sku: product.sku, quantity: 4 });
    const store = new ProcurementStore(prisma);

    await Promise.all([
      store.assessApprovedOrder(tenantA, first.orderId, userA),
      store.assessApprovedOrder(tenantA, second.orderId, userA),
    ]);
    await store.assessApprovedOrder(tenantA, first.orderId, userA);

    const items = await prisma.orderItem.findMany({
      where: { id: { in: [first.itemId, second.itemId] } },
      orderBy: { id: 'asc' },
    });
    const reservations = await prisma.inventoryReservation.findMany({
      where: { tenantId: tenantA, productId: product.id, status: 'ACTIVE' },
    });

    expect(items.map((item) => item.procurementStatus).sort()).toEqual(['IN_STOCK', 'TO_ORDER']);
    expect(reservations).toHaveLength(1);
    expect(reservations.reduce((sum, reservation) => sum + reservation.quantity, 0)).toBe(4);
  });

  it('does not assess an order that has not been approved', async () => {
    const fixture = await createApprovedOrder(prisma, { sku: 'NOT-APPROVED', stock: 3, quantity: 1 });
    await prisma.order.update({ where: { id: fixture.orderId }, data: { status: 'NEEDS_REVIEW' } });
    const store = new ProcurementStore(prisma);

    await expect(store.assessApprovedOrder(tenantA, fixture.orderId, userA))
      .rejects.toThrow('Only approved orders');

    expect(await prisma.inventoryReservation.count({ where: { orderItemId: fixture.itemId } })).toBe(0);
    expect((await prisma.orderItem.findUniqueOrThrow({ where: { id: fixture.itemId } })).procurementStatus)
      .toBe('UNASSESSED');
  });

  it('releases an active order reservation once', async () => {
    const fixture = await createApprovedOrder(prisma, { sku: 'RELEASE', stock: 3, quantity: 2 });
    const store = new ProcurementStore(prisma);
    await store.assessApprovedOrder(tenantA, fixture.orderId, userA);

    await store.releaseOrderReservations(tenantA, fixture.orderId, userA);
    await store.releaseOrderReservations(tenantA, fixture.orderId, userA);

    expect(await prisma.inventoryReservation.findUniqueOrThrow({
      where: { tenantId_orderItemId: { tenantId: tenantA, orderItemId: fixture.itemId } },
    })).toMatchObject({ status: 'RELEASED', releasedAt: expect.any(Date) });
    expect(await prisma.auditLog.count({
      where: { orderId: fixture.orderId, action: 'PROCUREMENT_RESERVATIONS_RELEASED' },
    })).toBe(1);
  });

  it('applies allowed manual transitions and reservation side effects', async () => {
    const fixture = await createApprovedOrder(prisma, { sku: 'MANUAL-STOCK', stock: 3, quantity: 2 });
    const store = new ProcurementStore(prisma);
    await store.assessApprovedOrder(tenantA, fixture.orderId, userA);

    await store.setItemStatus(tenantA, fixture.orderId, fixture.itemId, 'TO_ORDER', userA);
    expect(await prisma.inventoryReservation.findUniqueOrThrow({
      where: { tenantId_orderItemId: { tenantId: tenantA, orderItemId: fixture.itemId } },
    })).toMatchObject({ status: 'RELEASED' });

    await store.setItemStatus(tenantA, fixture.orderId, fixture.itemId, 'IN_STOCK', userA);
    expect(await prisma.inventoryReservation.findUniqueOrThrow({
      where: { tenantId_orderItemId: { tenantId: tenantA, orderItemId: fixture.itemId } },
    })).toMatchObject({ status: 'ACTIVE', quantity: 2 });
    expect(await prisma.orderItem.findUniqueOrThrow({ where: { id: fixture.itemId } }))
      .toMatchObject({ procurementStatus: 'IN_STOCK', procurementSource: 'MANUAL', procurementReason: 'MANUAL_IN_STOCK' });
  });

  it('allows supplier confirmation flow and rejects skipped states', async () => {
    const fixture = await createApprovedOrder(prisma, { sku: 'SUPPLIER-FLOW', stock: null, quantity: 1 });
    const store = new ProcurementStore(prisma);
    await store.assessApprovedOrder(tenantA, fixture.orderId, userA);

    await expect(store.setItemStatus(tenantA, fixture.orderId, fixture.itemId, 'RECEIVED', userA))
      .rejects.toThrow('Invalid procurement transition');
    await prisma.orderItem.update({ where: { id: fixture.itemId }, data: { procurementStatus: 'ORDERED' } });
    await store.setItemStatus(tenantA, fixture.orderId, fixture.itemId, 'SUPPLIER_CONFIRMED', userA);
    await store.setItemStatus(tenantA, fixture.orderId, fixture.itemId, 'RECEIVED', userA);

    expect((await prisma.orderItem.findUniqueOrThrow({ where: { id: fixture.itemId } })).procurementStatus)
      .toBe('RECEIVED');
  });

  it('allows an unavailable item to return to supplier ordering', async () => {
    const fixture = await createApprovedOrder(prisma, { sku: 'UNAVAILABLE-FLOW', stock: null, quantity: 1 });
    const store = new ProcurementStore(prisma);
    await store.assessApprovedOrder(tenantA, fixture.orderId, userA);
    await store.setItemStatus(tenantA, fixture.orderId, fixture.itemId, 'UNAVAILABLE', userA);

    await store.setItemStatus(tenantA, fixture.orderId, fixture.itemId, 'TO_ORDER', userA);

    expect((await prisma.orderItem.findUniqueOrThrow({ where: { id: fixture.itemId } })).procurementStatus)
      .toBe('TO_ORDER');
  });

  it('rejects cross-tenant item transitions without mutation', async () => {
    const store = new ProcurementStore(prisma);
    await expect(store.setItemStatus(tenantA, orderB, itemB, 'TO_ORDER', userA))
      .rejects.toThrow('Procurement item not found');
    expect((await prisma.orderItem.findUniqueOrThrow({ where: { id: itemB } })).procurementStatus)
      .toBe('UNASSESSED');
  });

  it('hands off a ready order once and consumes its reserved stock', async () => {
    const fixture = await createApprovedOrder(prisma, { sku: 'HAND-OFF', stock: 5, quantity: 2 });
    const store = new ProcurementStore(prisma);
    await store.assessApprovedOrder(tenantA, fixture.orderId, userA);

    const first = await store.handOffOrder(tenantA, fixture.orderId, userA);
    const replay = await store.handOffOrder(tenantA, fixture.orderId, userA);

    expect(first.summary).toBe('HANDED_OFF');
    expect(replay).toEqual(first);
    expect(await prisma.product.findFirstOrThrow({ where: { tenantId: tenantA, sku: 'HAND-OFF' } }))
      .toMatchObject({ stockQuantity: 3 });
    expect(await prisma.inventoryReservation.findUniqueOrThrow({
      where: { tenantId_orderItemId: { tenantId: tenantA, orderItemId: fixture.itemId } },
    })).toMatchObject({ status: 'CONSUMED', consumedAt: expect.any(Date) });
    expect(await prisma.auditLog.count({ where: { orderId: fixture.orderId, action: 'ORDER_HANDED_OFF' } }))
      .toBe(1);
  });
});

async function createApprovedOrder(
  prisma: PrismaClient,
  input: { sku: string; quantity: number; stock?: number | null },
): Promise<{ orderId: string; itemId: string }> {
  if (input.stock !== undefined) {
    await prisma.product.create({
      data: {
        tenantId: tenantA,
        sku: input.sku,
        name: input.sku,
        aliases: [],
        stockQuantity: input.stock,
      },
    });
  }
  const token = randomUUID();
  const message = await prisma.message.create({
    data: {
      tenantId: tenantA,
      conversationId: conversationA,
      channel: 'INSTAGRAM',
      externalMessageId: `procurement-${token}`,
      direction: 'OUTBOUND',
      senderId: 'shop',
      text: 'Order trigger',
      sourceTimestamp: new Date(),
      clientIdempotencyKey: token,
      deliveryStatus: 'SENT',
    },
  });
  const order = await prisma.order.create({
    data: {
      tenantId: tenantA,
      conversationId: conversationA,
      triggerMessageId: message.id,
      status: 'APPROVED',
      promptVersion: 'test',
      approvedAt: new Date(),
      approvedBy: userA,
    },
  });
  const item = await prisma.orderItem.create({
    data: {
      tenantId: tenantA,
      orderId: order.id,
      catalogId: input.sku,
      originalText: input.sku,
      quantity: input.quantity,
      confidence: 1,
    },
  });
  return { orderId: order.id, itemId: item.id };
}

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
import { randomUUID } from 'node:crypto';
