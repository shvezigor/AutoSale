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

describe('Telegram row-level security', () => {
  let container: StartedPostgreSqlContainer;
  let adminPool: pg.Pool;
  let admin: PrismaClient;
  let api: PrismaClient;
  let worker: PrismaClient;
  let fixtureA: Awaited<ReturnType<typeof seedTelegram>>;
  let fixtureB: Awaited<ReturnType<typeof seedTelegram>>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    adminPool = new pg.Pool({ connectionString: container.getConnectionUri() });
    await applyMigrations(adminPool);
    admin = createPrismaClient(container.getConnectionUri());
    fixtureA = await seedTelegram(admin, tenantA, userA, 'tenant-a');
    fixtureB = await seedTelegram(admin, tenantB, userB, 'tenant-b');
    await configureRuntimeDatabaseRoles(container.getConnectionUri(), { apiPassword, workerPassword });
    api = createPrismaClient(runtimeUrl(container.getConnectionUri(), 'autosale_api', apiPassword));
    worker = createPrismaClient(runtimeUrl(container.getConnectionUri(), 'autosale_worker', workerPassword));
  }, 60_000);

  afterAll(async () => {
    await api?.$disconnect();
    await worker?.$disconnect();
    await admin?.$disconnect();
    await adminPool?.end();
    await container?.stop();
  });

  it('fails closed without tenant context and exposes only the selected tenant Telegram records', async () => {
    for (const client of [api, worker]) {
      await expect(client.telegramLinkAttempt.findMany()).resolves.toEqual([]);
      await expect(client.telegramUserBinding.findMany()).resolves.toEqual([]);
      await expect(client.telegramBusinessConnection.findMany()).resolves.toEqual([]);
      await expect(client.telegramChat.findMany()).resolves.toEqual([]);
      await expect(client.telegramSupplierSetting.findMany()).resolves.toEqual([]);
      await expect(client.telegramDelivery.findMany()).resolves.toEqual([]);
      await expect(client.telegramDeliveryItem.findMany()).resolves.toEqual([]);
      await expect(client.telegramNotificationPreference.findMany()).resolves.toEqual([]);
    }

    await expect(withTenantTransaction(api, tenantA, async (tx) => ({
      attempts: await tx.telegramLinkAttempt.count(),
      bindings: await tx.telegramUserBinding.count(),
      connections: await tx.telegramBusinessConnection.count(),
      chats: await tx.telegramChat.count(),
      settings: await tx.telegramSupplierSetting.count(),
      deliveries: await tx.telegramDelivery.count(),
      items: await tx.telegramDeliveryItem.count(),
      preferences: await tx.telegramNotificationPreference.count(),
    }))).resolves.toEqual({
      attempts: 1,
      bindings: 1,
      connections: 1,
      chats: 1,
      settings: 1,
      deliveries: 1,
      items: 1,
      preferences: 1,
    });
  });

  it('rejects cross-tenant Telegram writes', async () => {
    await expect(withTenantTransaction(api, tenantA, (tx) => tx.telegramChat.update({
      where: { id: fixtureB.chatId },
      data: { title: 'Forbidden' },
    }))).rejects.toMatchObject({ code: 'P2025' });
  });

  it('allows only the API role to consume and resolve exact Telegram callback authority', async () => {
    const consumed = await api.$queryRaw<Array<{ tenant_id: string; attempt_id: string }>>`
      SELECT tenant_id, attempt_id
      FROM public.api_consume_telegram_link_attempt(
        ${'hash-tenant-a'}, ${'PERSONAL'}, ${new Date('2026-10-01T10:00:00.000Z')}
      )
    `;
    expect(consumed).toEqual([{ tenant_id: tenantA, attempt_id: fixtureA.attemptId }]);
    await expect(api.$queryRaw`
      SELECT * FROM public.api_consume_telegram_link_attempt(
        ${'hash-tenant-a'}, ${'PERSONAL'}, ${new Date('2026-10-01T10:00:01.000Z')}
      )
    `).resolves.toEqual([]);
    await expect(api.$queryRaw`
      SELECT * FROM public.api_consume_telegram_link_attempt(
        ${'hash-tenant-b'}, ${'SUPPLIER_GROUP'}, ${new Date('2026-10-01T10:00:00.000Z')}
      )
    `).resolves.toEqual([]);

    await expect(api.$queryRaw`
      SELECT tenant_id FROM public.api_telegram_tenant_for_user(${'telegram-user-tenant-a'})
    `).resolves.toEqual([{ tenant_id: tenantA }]);
    await expect(api.$queryRaw`
      SELECT tenant_id FROM public.api_telegram_tenant_for_business_connection(${'business-tenant-a'})
    `).resolves.toEqual([{ tenant_id: tenantA }]);

    await expect(worker.$queryRaw`
      SELECT * FROM public.api_telegram_tenant_for_user(${'telegram-user-tenant-a'})
    `).rejects.toMatchObject({ code: 'P2010' });
    await expect(worker.$queryRaw`
      SELECT * FROM public.api_consume_telegram_link_attempt(
        ${'hash-tenant-b'}, ${'PERSONAL'}, ${new Date('2026-10-01T10:00:00.000Z')}
      )
    `).rejects.toMatchObject({ code: 'P2010' });
  });

  it('fails closed when Telegram callback authority is ambiguous', async () => {
    await admin.telegramUserBinding.update({
      where: { id: fixtureB.bindingId },
      data: { telegramUserId: 'telegram-user-tenant-a' },
    });
    await admin.telegramBusinessConnection.update({
      where: { id: fixtureB.connectionId },
      data: { externalConnectionId: 'business-tenant-a' },
    });

    await expect(api.$queryRaw`
      SELECT tenant_id FROM public.api_telegram_tenant_for_user(${'telegram-user-tenant-a'})
    `).resolves.toEqual([]);
    await expect(api.$queryRaw`
      SELECT tenant_id FROM public.api_telegram_tenant_for_business_connection(${'business-tenant-a'})
    `).resolves.toEqual([]);
  });

  it('allows only the worker role to resolve and discover bounded Telegram delivery authority', async () => {
    const resolved = await worker.$queryRaw<Array<{ tenant_id: string; delivery_id: string; purpose: string }>>`
      SELECT tenant_id, delivery_id, purpose
      FROM public.worker_telegram_tenants_for_deliveries(${[fixtureA.deliveryId, fixtureB.deliveryId]}::uuid[])
      ORDER BY delivery_id
    `;
    expect(resolved).toEqual([
      { tenant_id: tenantA, delivery_id: fixtureA.deliveryId, purpose: 'SUPPLIER_ORDER' },
      { tenant_id: tenantB, delivery_id: fixtureB.deliveryId, purpose: 'SUPPLIER_ORDER' },
    ].sort((left, right) => left.delivery_id.localeCompare(right.delivery_id)));

    const due = await worker.$queryRaw<Array<{ tenant_id: string; delivery_id: string; purpose: string }>>`
      SELECT tenant_id, delivery_id, purpose
      FROM public.worker_due_telegram_deliveries(${new Date('2099-01-01T00:00:00.000Z')}, ${50})
      ORDER BY delivery_id
    `;
    expect(due).toHaveLength(2);
    await expect(api.$queryRaw`
      SELECT * FROM public.worker_due_telegram_deliveries(${new Date('2099-01-01T00:00:00.000Z')}, ${50})
    `).rejects.toMatchObject({ code: 'P2010' });
    await expect(api.$queryRaw`
      SELECT * FROM public.worker_telegram_tenants_for_deliveries(${[fixtureA.deliveryId]}::uuid[])
    `).rejects.toMatchObject({ code: 'P2010' });
    await expect(worker.$queryRaw`
      SELECT * FROM public.worker_telegram_tenants_for_deliveries(
        ${Array.from({ length: 51 }, () => fixtureA.deliveryId)}::uuid[]
      )
    `).rejects.toMatchObject({ code: 'P2010' });
  });
});

async function seedTelegram(prisma: PrismaClient, tenantId: string, userId: string, suffix: string) {
  await prisma.tenant.create({ data: { id: tenantId, key: suffix, name: `Fictional ${suffix}` } });
  await prisma.user.create({ data: {
    id: userId,
    email: `${suffix}@example.invalid`,
    name: `Fictional ${suffix}`,
    status: 'ACTIVE',
  } });
  const attempt = await prisma.telegramLinkAttempt.create({ data: {
    tenantId,
    userId,
    purpose: 'PERSONAL',
    tokenHash: `hash-${suffix}`,
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
  } });
  const binding = await prisma.telegramUserBinding.create({ data: {
    tenantId,
    userId,
    telegramUserId: `telegram-user-${suffix}`,
    privateChatId: `private-chat-${suffix}`,
    displayName: `Fictional ${suffix}`,
  } });
  const connection = await prisma.telegramBusinessConnection.create({ data: {
    tenantId,
    externalConnectionId: `business-${suffix}`,
    telegramUserId: `telegram-user-${suffix}`,
    rights: {},
    enabled: true,
    lastUpdatedAt: new Date('2026-10-01T09:00:00.000Z'),
  } });
  const chat = await prisma.telegramChat.create({ data: {
    tenantId,
    externalChatId: `supplier-chat-${suffix}`,
    type: 'private',
    title: `Fictional supplier ${suffix}`,
    route: 'BUSINESS',
    businessConnectionId: connection.externalConnectionId,
    lastObservedAt: new Date('2026-10-01T09:00:00.000Z'),
  } });
  await prisma.telegramSupplierSetting.create({ data: { tenantId, destinationId: chat.id } });
  await prisma.telegramNotificationPreference.create({ data: {
    tenantId,
    userId,
    eventType: 'ORDER_NEEDS_REVIEW',
    enabled: true,
  } });
  const conversation = await prisma.conversation.create({ data: {
    tenantId,
    channel: 'INSTAGRAM',
    externalConversationId: `conversation-${suffix}`,
    participantId: `participant-${suffix}`,
    lastMessageAt: new Date('2026-10-01T09:00:00.000Z'),
  } });
  const message = await prisma.message.create({ data: {
    tenantId,
    conversationId: conversation.id,
    channel: 'INSTAGRAM',
    externalMessageId: `message-${suffix}`,
    direction: 'INBOUND',
    senderId: `sender-${suffix}`,
    text: 'Fictional order',
    sourceTimestamp: new Date('2026-10-01T09:00:00.000Z'),
    clientIdempotencyKey: crypto.randomUUID(),
  } });
  const order = await prisma.order.create({ data: {
    tenantId,
    conversationId: conversation.id,
    triggerMessageId: message.id,
    status: 'APPROVED',
    promptVersion: 'fictional-test-v1',
  } });
  const item = await prisma.orderItem.create({ data: {
    tenantId,
    orderId: order.id,
    originalText: 'Fictional item',
    quantity: 1,
    confidence: 1,
    procurementStatus: 'SENDING',
  } });
  const delivery = await prisma.telegramDelivery.create({ data: {
    tenantId,
    destinationId: chat.id,
    orderId: order.id,
    purpose: 'SUPPLIER_ORDER',
    idempotencyKey: `delivery-${suffix}`,
    messageText: 'Fictional supplier order',
    nextAttemptAt: new Date('2026-10-01T09:00:00.000Z'),
  } });
  await prisma.telegramDeliveryItem.create({ data: {
    tenantId,
    deliveryId: delivery.id,
    orderItemId: item.id,
  } });
  return {
    attemptId: attempt.id,
    bindingId: binding.id,
    connectionId: connection.id,
    chatId: chat.id,
    deliveryId: delivery.id,
  };
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
