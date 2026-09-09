import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createPrismaClient, type PrismaClient } from '@autosale/database';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { TelegramService } from './telegram.service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';

describe('TelegramService webhook processing', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    await applyMigrations(pool);
    await pool.end();
    prisma = createPrismaClient(container.getConnectionUri());
    await prisma.tenant.create({ data: { id: tenantId, key: 'telegram-api', name: 'Telegram API' } });
    await prisma.user.create({ data: { id: userId, email: 'telegram@example.com', name: 'Telegram User', status: 'ACTIVE' } });
  }, 60_000);

  beforeEach(async () => {
    await prisma.telegramDelivery.deleteMany();
    await prisma.telegramChat.deleteMany();
    await prisma.telegramBusinessConnection.deleteMany();
    await prisma.telegramUserBinding.deleteMany();
    await prisma.telegramLinkAttempt.deleteMany();
    await prisma.telegramWebhookUpdate.deleteMany();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it('consumes a private Start token and links the intended member', async () => {
    await linkAttempt(prisma, 'personal-token', 'PERSONAL');
    const service = new TelegramService(prisma);

    await expect(service.handleWebhook(messageUpdate(101, 'private', '/start personal-token'))).resolves.toBe('PROCESSED');

    await expect(prisma.telegramUserBinding.findUnique({ where: { tenantId_userId: { tenantId, userId } } })).resolves.toMatchObject({
      telegramUserId: '987654321', privateChatId: '987654321', displayName: 'Ihor Shvets', username: 'shvezigor', revokedAt: null,
    });
  });

  it('acknowledges a replay without consuming or processing it twice', async () => {
    await linkAttempt(prisma, 'replay-token', 'PERSONAL');
    const service = new TelegramService(prisma);
    const update = messageUpdate(102, 'private', '/start replay-token');

    await expect(service.handleWebhook(update)).resolves.toBe('PROCESSED');
    await expect(service.handleWebhook(update)).resolves.toBe('REPLAY');
    await expect(prisma.telegramWebhookUpdate.count()).resolves.toBe(1);
  });

  it('links a supplier group only to the token-bound tenant', async () => {
    await linkAttempt(prisma, 'group-token', 'SUPPLIER_GROUP');
    const service = new TelegramService(prisma);

    await service.handleWebhook(messageUpdate(103, 'supergroup', '/start@AutoSaleBot group-token', '-1001234567890'));

    await expect(prisma.telegramChat.findFirst({ where: { tenantId } })).resolves.toMatchObject({
      externalChatId: '-1001234567890', type: 'supergroup', title: 'Supplier Group', route: 'BOT',
    });
  });

  it('records a business connection only when one active binding identifies its tenant', async () => {
    await prisma.telegramUserBinding.create({ data: {
      tenantId, userId, telegramUserId: '987654321', privateChatId: '987654321', displayName: 'Ihor',
    } });
    const service = new TelegramService(prisma);

    await service.handleWebhook({
      update_id: 104,
      business_connection: {
        id: 'business-1', user: { id: 987654321, is_bot: false, first_name: 'Ihor' },
        user_chat_id: 987654321, date: 1_788_000_000,
        rights: { can_reply: true }, is_enabled: true,
      },
    });

    await expect(prisma.telegramBusinessConnection.findFirst({ where: { tenantId } })).resolves.toMatchObject({
      externalConnectionId: 'business-1', telegramUserId: '987654321', enabled: true,
    });
  });

  it('observes a permitted Telegram Business chat without persisting message contents', async () => {
    await prisma.telegramBusinessConnection.create({ data: {
      tenantId, externalConnectionId: 'business-1', telegramUserId: '987654321',
      rights: { can_reply: true }, enabled: true, lastUpdatedAt: new Date(),
    } });
    const service = new TelegramService(prisma);

    await expect(service.handleWebhook({
      update_id: 105,
      business_message: {
        message_id: 42,
        business_connection_id: 'business-1',
        date: 1_788_000_000,
        text: 'Private supplier message that must not be stored',
        chat: { id: 123456789, type: 'private', first_name: 'Supplier', username: 'supplier_shop' },
      },
    })).resolves.toBe('PROCESSED');

    await expect(prisma.telegramChat.findUnique({
      where: { tenantId_externalChatId_route: { tenantId, externalChatId: '123456789', route: 'BUSINESS' } },
    })).resolves.toMatchObject({
      type: 'private', title: 'Supplier (@supplier_shop)', route: 'BUSINESS', businessConnectionId: 'business-1',
    });
    expect(JSON.stringify(await prisma.telegramChat.findMany())).not.toContain('Private supplier message');
  });

  it('rejects malformed updates before recording a replay marker', async () => {
    const service = new TelegramService(prisma);

    await expect(service.handleWebhook({ update_id: 'not-a-number', message: { text: '/start token' } })).rejects.toThrow('Invalid Telegram update');
    await expect(prisma.telegramWebhookUpdate.count()).resolves.toBe(0);
  });

  it('creates a short-lived hashed personal deep link without storing its raw token', async () => {
    const now = new Date('2026-09-08T12:00:00.000Z');
    const service = new TelegramService(prisma, () => now, { botUsername: 'AutoSaleBot', token: () => 'deterministic_token_value_1234567890' });

    await expect(service.startLink(tenantId, userId, 'PERSONAL', '/settings?tab=telegram')).resolves.toEqual({
      url: 'https://t.me/AutoSaleBot?start=deterministic_token_value_1234567890',
      expiresAt: '2026-09-08T12:05:00.000Z',
    });
    const attempt = await prisma.telegramLinkAttempt.findFirstOrThrow();
    expect(attempt.tokenHash).toBe(createHash('sha256').update('deterministic_token_value_1234567890').digest('hex'));
    expect(JSON.stringify(attempt)).not.toContain('deterministic_token_value_1234567890');
  });

  it('returns only the current member binding and revokes it without deleting history', async () => {
    await prisma.telegramUserBinding.create({ data: {
      tenantId, userId, telegramUserId: '987654321', privateChatId: '987654321', displayName: 'Ihor', username: 'shvezigor',
    } });
    const service = new TelegramService(prisma, () => new Date('2026-09-08T12:00:00.000Z'), { botUsername: 'AutoSaleBot' });

    await expect(service.summary(tenantId, userId)).resolves.toMatchObject({
      available: true, botUsername: 'AutoSaleBot', personal: { connected: true, displayName: 'Ihor', username: 'shvezigor' },
    });
    await expect(service.unlink(tenantId, userId)).resolves.toEqual({ disconnected: true });
    await expect(prisma.telegramUserBinding.count()).resolves.toBe(1);
    await expect(service.summary(tenantId, userId)).resolves.toMatchObject({ personal: { connected: false } });
  });

  it('persists a privacy-safe test notification before waking the delivery worker', async () => {
    await prisma.telegramUserBinding.create({ data: {
      tenantId, userId, telegramUserId: '987654321', privateChatId: '987654321', displayName: 'Ihor',
    } });
    const chat = await prisma.telegramChat.create({ data: {
      tenantId, externalChatId: '987654321', type: 'private', route: 'BOT', lastObservedAt: new Date(),
    } });
    const add = vi.fn(async (_name: string, data: { deliveryId: string }) => {
      await expect(prisma.telegramDelivery.findUnique({ where: { id: data.deliveryId } })).resolves.toMatchObject({
        tenantId,
        destinationId: chat.id,
        purpose: 'TEST',
        status: 'PENDING',
        messageText: 'AutoSale підключено. Тестове сповіщення працює.',
      });
    });
    const service = new TelegramService(prisma, undefined, { botUsername: 'AutoSaleBot', queue: { add } });

    const result = await service.queueTest(tenantId, userId);

    expect(result).toMatchObject({ status: 'PENDING' });
    expect(add).toHaveBeenCalledWith('telegram.deliver', { deliveryId: result.deliveryId }, {
      jobId: `telegram:${result.deliveryId}`, attempts: 1, removeOnComplete: true, removeOnFail: true,
    });
  });

  it('keeps a persisted test notification pending when the queue wake-up fails', async () => {
    await prisma.telegramUserBinding.create({ data: {
      tenantId, userId, telegramUserId: '987654321', privateChatId: '987654321', displayName: 'Ihor',
    } });
    await prisma.telegramChat.create({ data: {
      tenantId, externalChatId: '987654321', type: 'private', route: 'BOT', lastObservedAt: new Date(),
    } });
    const service = new TelegramService(prisma, undefined, {
      botUsername: 'AutoSaleBot',
      queue: { add: vi.fn().mockRejectedValue(new Error('redis unavailable')) },
    });

    const result = await service.queueTest(tenantId, userId);

    await expect(prisma.telegramDelivery.findUnique({ where: { id: result.deliveryId } })).resolves.toMatchObject({ status: 'PENDING' });
  });

  it('does not queue a test notification for an unlinked member', async () => {
    const service = new TelegramService(prisma, undefined, { botUsername: 'AutoSaleBot', queue: { add: vi.fn() } });

    await expect(service.queueTest(tenantId, userId)).rejects.toThrow('Telegram personal connection required');
    await expect(prisma.telegramDelivery.count()).resolves.toBe(0);
  });
});

async function linkAttempt(prisma: PrismaClient, rawToken: string, purpose: 'PERSONAL' | 'SUPPLIER_GROUP') {
  return prisma.telegramLinkAttempt.create({ data: {
    tenantId, userId, purpose,
    tokenHash: createHash('sha256').update(rawToken).digest('hex'),
    expiresAt: new Date(Date.now() + 300_000),
  } });
}

function messageUpdate(updateId: number, type: 'private' | 'supergroup', text: string, chatId = '987654321') {
  return {
    update_id: updateId,
    message: {
      message_id: 1, date: 1_788_000_000, text,
      from: { id: 987654321, is_bot: false, first_name: 'Ihor', last_name: 'Shvets', username: 'shvezigor' },
      chat: { id: Number(chatId), type, ...(type === 'supergroup' ? { title: 'Supplier Group' } : {}) },
    },
  };
}

async function applyMigrations(pool: pg.Pool): Promise<void> {
  const root = resolve(process.cwd(), '../../packages/database/prisma/migrations');
  for (const name of (await readdir(root)).sort()) {
    if (name === 'migration_lock.toml') continue;
    await pool.query(await readFile(resolve(root, name, 'migration.sql'), 'utf8'));
  }
}
