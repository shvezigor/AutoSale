import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createPrismaClient, type PrismaClient } from '@autosale/database';
import { TelegramBotError } from '@autosale/integrations';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { TelegramDeliveryService } from './telegram-delivery.service.js';

describe('TelegramDeliveryService', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let tenantId: string;
  let destinationId: string;
  const now = new Date('2026-09-08T12:00:00.000Z');
  const sendText = vi.fn();

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    const connectionString = container.getConnectionUri();
    await applyMigrations(connectionString);
    prisma = createPrismaClient(connectionString);
    const tenant = await prisma.tenant.create({ data: { key: 'telegram-delivery', name: 'Telegram delivery' } });
    tenantId = tenant.id;
    const destination = await prisma.telegramChat.create({
      data: {
        tenantId,
        externalChatId: '-1001234567890',
        type: 'supergroup',
        title: 'Supplier',
        route: 'BOT',
        lastObservedAt: now,
      },
    });
    destinationId = destination.id;
  }, 60_000);

  beforeEach(() => {
    sendText.mockReset().mockResolvedValue({ messageId: '701', chatId: '-1001234567890' });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it('claims a due delivery once and records the provider message id', async () => {
    const delivery = await prisma.telegramDelivery.create({
      data: {
        tenantId,
        destinationId,
        purpose: 'TEST',
        idempotencyKey: randomUUID(),
        messageText: 'AutoSale: тестове сповіщення',
        nextAttemptAt: now,
      },
    });
    const service = new TelegramDeliveryService(prisma, { sendText }, () => now);

    await expect(service.process({ deliveryId: delivery.id })).resolves.toBe('SUCCEEDED');
    await expect(service.process({ deliveryId: delivery.id })).resolves.toBe('IGNORED');

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith({
      chatId: '-1001234567890',
      text: 'AutoSale: тестове сповіщення',
    });
    await expect(prisma.telegramDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).resolves.toMatchObject({
      status: 'SUCCEEDED',
      providerMessageId: '701',
      attempts: 1,
      leaseId: null,
      leaseExpiresAt: null,
      lastErrorCode: null,
      completedAt: now,
    });
  });

  it('schedules the provider retry delay for rate limiting and stops after five attempts', async () => {
    const retrying = await prisma.telegramDelivery.create({
      data: {
        tenantId,
        destinationId,
        purpose: 'TEST',
        idempotencyKey: randomUUID(),
        messageText: 'AutoSale: тестове сповіщення',
        nextAttemptAt: now,
      },
    });
    sendText.mockRejectedValueOnce(new TelegramBotError('RATE_LIMITED', 429, 30));
    const service = new TelegramDeliveryService(prisma, { sendText }, () => now);

    await expect(service.process({ deliveryId: retrying.id })).resolves.toBe('RETRY');
    await expect(prisma.telegramDelivery.findUniqueOrThrow({ where: { id: retrying.id } })).resolves.toMatchObject({
      status: 'RETRYABLE',
      attempts: 1,
      nextAttemptAt: new Date(now.getTime() + 30_000),
      lastErrorCode: 'TELEGRAM_RATE_LIMITED',
      leaseId: null,
    });

    const exhausted = await prisma.telegramDelivery.create({
      data: {
        tenantId,
        destinationId,
        purpose: 'TEST',
        idempotencyKey: randomUUID(),
        messageText: 'AutoSale: тестове сповіщення',
        attempts: 4,
        nextAttemptAt: now,
      },
    });
    sendText.mockRejectedValueOnce(new TelegramBotError('RATE_LIMITED', 429, 30));
    await expect(service.process({ deliveryId: exhausted.id })).resolves.toBe('FAILED');
    await expect(prisma.telegramDelivery.findUniqueOrThrow({ where: { id: exhausted.id } })).resolves.toMatchObject({
      status: 'FAILED',
      attempts: 5,
      lastErrorCode: 'TELEGRAM_RATE_LIMITED',
      leaseId: null,
      completedAt: now,
    });
  });

  it.each([
    ['ambiguous timeout', new TelegramBotError('TIMEOUT', null), 'TELEGRAM_DELIVERY_UNKNOWN'],
    ['blocked destination', new TelegramBotError('FORBIDDEN', 403), 'TELEGRAM_FORBIDDEN'],
  ])('stores a safe terminal code for %s without retrying', async (_name, failure, expectedCode) => {
    const delivery = await prisma.telegramDelivery.create({
      data: {
        tenantId,
        destinationId,
        purpose: 'TEST',
        idempotencyKey: randomUUID(),
        messageText: 'AutoSale: тестове сповіщення',
        nextAttemptAt: now,
      },
    });
    sendText.mockRejectedValueOnce(failure);

    await expect(new TelegramDeliveryService(prisma, { sendText }, () => now)
      .process({ deliveryId: delivery.id })).resolves.toBe('FAILED');

    await expect(prisma.telegramDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).resolves.toMatchObject({
      status: 'FAILED',
      attempts: 1,
      nextAttemptAt: now,
      lastErrorCode: expectedCode,
      leaseId: null,
      completedAt: now,
    });
  });

  it('allows only one competing worker to send the same delivery', async () => {
    const delivery = await prisma.telegramDelivery.create({
      data: {
        tenantId,
        destinationId,
        purpose: 'TEST',
        idempotencyKey: randomUUID(),
        messageText: 'AutoSale: тестове сповіщення',
        nextAttemptAt: now,
      },
    });
    let release!: () => void;
    sendText.mockImplementationOnce(() => new Promise((resolveSend) => {
      release = () => resolveSend({ messageId: '702', chatId: '-1001234567890' });
    }));
    const service = new TelegramDeliveryService(prisma, { sendText }, () => now);

    const first = service.process({ deliveryId: delivery.id });
    await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(1));
    await expect(service.process({ deliveryId: delivery.id })).resolves.toBe('IGNORED');
    release();

    await expect(first).resolves.toBe('SUCCEEDED');
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it('fails closed when a business destination has no verified connection', async () => {
    const destination = await prisma.telegramChat.create({
      data: {
        tenantId,
        externalChatId: '987654321',
        type: 'private',
        title: 'Supplier business chat',
        route: 'BUSINESS',
        lastObservedAt: now,
      },
    });
    const delivery = await prisma.telegramDelivery.create({
      data: {
        tenantId,
        destinationId: destination.id,
        purpose: 'SUPPLIER_ORDER',
        idempotencyKey: randomUUID(),
        messageText: 'Замовлення постачальнику',
        nextAttemptAt: now,
      },
    });

    await expect(new TelegramDeliveryService(prisma, { sendText }, () => now)
      .process({ deliveryId: delivery.id })).resolves.toBe('FAILED');

    expect(sendText).not.toHaveBeenCalled();
    await expect(prisma.telegramDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).resolves.toMatchObject({
      status: 'FAILED',
      lastErrorCode: 'TELEGRAM_DESTINATION_INVALID',
      leaseId: null,
      completedAt: now,
    });
  });

  it('does not report success when Telegram returns a different destination', async () => {
    const delivery = await prisma.telegramDelivery.create({
      data: {
        tenantId,
        destinationId,
        purpose: 'TEST',
        idempotencyKey: randomUUID(),
        messageText: 'AutoSale: тестове сповіщення',
        nextAttemptAt: now,
      },
    });
    sendText.mockResolvedValueOnce({ messageId: '703', chatId: '999999999' });

    await expect(new TelegramDeliveryService(prisma, { sendText }, () => now)
      .process({ deliveryId: delivery.id })).resolves.toBe('FAILED');

    await expect(prisma.telegramDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).resolves.toMatchObject({
      status: 'FAILED',
      providerMessageId: null,
      lastErrorCode: 'TELEGRAM_DESTINATION_MISMATCH',
      completedAt: now,
    });
  });

  it('recovers an expired processing lease after a worker restart', async () => {
    const delivery = await prisma.telegramDelivery.create({
      data: {
        tenantId,
        destinationId,
        purpose: 'TEST',
        idempotencyKey: randomUUID(),
        messageText: 'AutoSale: тестове сповіщення',
        status: 'PROCESSING',
        attempts: 1,
        nextAttemptAt: new Date(now.getTime() - 120_000),
        lastAttemptAt: new Date(now.getTime() - 120_000),
        leaseId: randomUUID(),
        leaseExpiresAt: new Date(now.getTime() - 60_000),
      },
    });

    await expect(new TelegramDeliveryService(prisma, { sendText }, () => now)
      .process({ deliveryId: delivery.id })).resolves.toBe('SUCCEEDED');

    expect(sendText).toHaveBeenCalledTimes(1);
    await expect(prisma.telegramDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).resolves.toMatchObject({
      status: 'SUCCEEDED',
      attempts: 2,
      providerMessageId: '701',
      leaseId: null,
      completedAt: now,
    });
  });

  it('marks only linked supplier items as ordered after successful delivery', async () => {
    const fixture = await createSupplierDelivery(prisma, { tenantId, destinationId, now });

    await expect(new TelegramDeliveryService(prisma, { sendText }, () => now)
      .process({ deliveryId: fixture.deliveryId })).resolves.toBe('SUCCEEDED');

    await expect(prisma.orderItem.findUniqueOrThrow({ where: { id: fixture.linkedItemId } }))
      .resolves.toMatchObject({ procurementStatus: 'ORDERED' });
    await expect(prisma.orderItem.findUniqueOrThrow({ where: { id: fixture.unlinkedItemId } }))
      .resolves.toMatchObject({ procurementStatus: 'SENDING' });
  });

  it('keeps supplier items sending while Telegram will retry', async () => {
    const fixture = await createSupplierDelivery(prisma, { tenantId, destinationId, now });
    sendText.mockRejectedValueOnce(new TelegramBotError('RATE_LIMITED', 429, 30));

    await expect(new TelegramDeliveryService(prisma, { sendText }, () => now)
      .process({ deliveryId: fixture.deliveryId })).resolves.toBe('RETRY');

    await expect(prisma.orderItem.findUniqueOrThrow({ where: { id: fixture.linkedItemId } }))
      .resolves.toMatchObject({ procurementStatus: 'SENDING' });
  });

  it('returns linked supplier items to ordering after terminal failure', async () => {
    const fixture = await createSupplierDelivery(prisma, { tenantId, destinationId, now });
    sendText.mockRejectedValueOnce(new TelegramBotError('FORBIDDEN', 403));

    await expect(new TelegramDeliveryService(prisma, { sendText }, () => now)
      .process({ deliveryId: fixture.deliveryId })).resolves.toBe('FAILED');

    await expect(prisma.orderItem.findUniqueOrThrow({ where: { id: fixture.linkedItemId } }))
      .resolves.toMatchObject({ procurementStatus: 'TO_ORDER', procurementReason: 'DELIVERY_FAILED' });
  });

  it('does not transition supplier items when a stale worker loses its lease', async () => {
    const fixture = await createSupplierDelivery(prisma, { tenantId, destinationId, now });
    let release!: () => void;
    sendText.mockImplementationOnce(() => new Promise((resolveSend) => {
      release = () => resolveSend({ messageId: '704', chatId: '-1001234567890' });
    }));
    const processing = new TelegramDeliveryService(prisma, { sendText }, () => now)
      .process({ deliveryId: fixture.deliveryId });
    await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(1));
    await prisma.telegramDelivery.update({
      where: { id: fixture.deliveryId },
      data: { leaseId: randomUUID() },
    });
    release();

    await expect(processing).resolves.toBe('IGNORED');
    await expect(prisma.orderItem.findUniqueOrThrow({ where: { id: fixture.linkedItemId } }))
      .resolves.toMatchObject({ procurementStatus: 'SENDING' });
  });
});

async function createSupplierDelivery(
  client: PrismaClient,
  input: { tenantId: string; destinationId: string; now: Date },
): Promise<{ deliveryId: string; linkedItemId: string; unlinkedItemId: string }> {
  const token = randomUUID();
  const conversation = await client.conversation.create({
    data: {
      tenantId: input.tenantId,
      channel: 'INSTAGRAM',
      externalConversationId: `supplier-${token}`,
      participantId: `participant-${token}`,
      lastMessageAt: input.now,
    },
  });
  const message = await client.message.create({
    data: {
      tenantId: input.tenantId,
      conversationId: conversation.id,
      channel: 'INSTAGRAM',
      externalMessageId: `supplier-${token}`,
      direction: 'OUTBOUND',
      senderId: 'shop',
      text: 'Order trigger',
      sourceTimestamp: input.now,
      clientIdempotencyKey: token,
      deliveryStatus: 'SENT',
    },
  });
  const order = await client.order.create({
    data: {
      tenantId: input.tenantId,
      conversationId: conversation.id,
      triggerMessageId: message.id,
      status: 'APPROVED',
      promptVersion: 'test',
    },
  });
  const [linked, unlinked] = await Promise.all([
    client.orderItem.create({
      data: {
        tenantId: input.tenantId,
        orderId: order.id,
        catalogId: 'SKU-LINKED',
        originalText: 'Linked item',
        quantity: 1,
        confidence: 1,
        procurementStatus: 'SENDING',
      },
    }),
    client.orderItem.create({
      data: {
        tenantId: input.tenantId,
        orderId: order.id,
        catalogId: 'SKU-UNLINKED',
        originalText: 'Unlinked item',
        quantity: 1,
        confidence: 1,
        procurementStatus: 'SENDING',
      },
    }),
  ]);
  const delivery = await client.telegramDelivery.create({
    data: {
      tenantId: input.tenantId,
      destinationId: input.destinationId,
      orderId: order.id,
      purpose: 'SUPPLIER_ORDER',
      idempotencyKey: `supplier-order:${token}`,
      messageText: 'Замовлення постачальнику',
      nextAttemptAt: input.now,
    },
  });
  await client.telegramDeliveryItem.create({
    data: { tenantId: input.tenantId, deliveryId: delivery.id, orderItemId: linked.id },
  });
  return { deliveryId: delivery.id, linkedItemId: linked.id, unlinkedItemId: unlinked.id };
}

async function applyMigrations(connectionString: string): Promise<void> {
  const pool = new pg.Pool({ connectionString });
  const directory = resolve(process.cwd(), '../../packages/database/prisma/migrations');
  const names = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => migrationOrderKey(left).localeCompare(migrationOrderKey(right)));
  for (const name of names) {
    await pool.query(await readFile(resolve(directory, name, 'migration.sql'), 'utf8'));
  }
  await pool.end();
}

function migrationOrderKey(name: string): string {
  return name === '20260828_meta_instagram_oauth' ? '20260828000000_meta_instagram_oauth' : name;
}
