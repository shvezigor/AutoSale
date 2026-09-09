import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { TelegramConnectionSummary, TelegramLinkPurpose, TelegramLinkResponse } from '@autosale/contracts';
import { Prisma, type PrismaClient } from '@autosale/database';
import { z } from 'zod';

const userSchema = z.object({
  id: z.number().safe().int(), is_bot: z.boolean(), first_name: z.string().min(1).max(128),
  last_name: z.string().max(128).optional(), username: z.string().max(32).optional(),
}).passthrough();
const chatSchema = z.object({
  id: z.number().safe().int(), type: z.enum(['private', 'group', 'supergroup']), title: z.string().max(255).optional(),
}).passthrough();
const messageSchema = z.object({
  text: z.string().max(4_096), from: userSchema, chat: chatSchema,
}).passthrough();
const businessConnectionSchema = z.object({
  id: z.string().min(1).max(128), user: userSchema, date: z.number().int(),
  rights: z.record(z.string(), z.unknown()), is_enabled: z.boolean(),
}).passthrough();
const updateSchema = z.object({
  update_id: z.number().safe().int().nonnegative(),
  message: messageSchema.optional(),
  business_connection: businessConnectionSchema.optional(),
}).passthrough().refine((value) => value.message !== undefined || value.business_connection !== undefined);

type TelegramUpdate = z.infer<typeof updateSchema>;

interface TelegramDeliveryQueue {
  add(
    name: 'telegram.deliver',
    data: { deliveryId: string },
    options: { jobId: string; attempts: 1; removeOnComplete: true; removeOnFail: true },
  ): Promise<unknown>;
}

export class TelegramService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
    private readonly options: { botUsername?: string; token?: () => string; queue?: TelegramDeliveryQueue } = {},
  ) {}

  async startLink(tenantId: string, userId: string, purpose: TelegramLinkPurpose, returnPath?: string): Promise<TelegramLinkResponse> {
    if (!this.options.botUsername) throw new Error('Telegram is not configured');
    const token = this.options.token?.() ?? randomBytes(32).toString('base64url');
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(token)) throw new Error('Telegram link token invalid');
    const expiresAt = new Date(this.now().getTime() + 5 * 60_000);
    await this.prisma.telegramLinkAttempt.create({ data: {
      tenantId, userId, purpose, tokenHash: createHash('sha256').update(token).digest('hex'),
      returnPath: safeReturnPath(returnPath), expiresAt,
    } });
    const parameter = purpose === 'PERSONAL' ? 'start' : 'startgroup';
    return { url: `https://t.me/${this.options.botUsername}?${parameter}=${token}`, expiresAt: expiresAt.toISOString() };
  }

  async summary(tenantId: string, userId: string): Promise<TelegramConnectionSummary> {
    const binding = await this.prisma.telegramUserBinding.findUnique({ where: { tenantId_userId: { tenantId, userId } } });
    const connected = Boolean(binding && !binding.revokedAt);
    return {
      available: Boolean(this.options.botUsername), botUsername: this.options.botUsername ?? null,
      personal: {
        connected,
        displayName: connected ? binding?.displayName ?? null : null,
        username: connected ? binding?.username ?? null : null,
        linkedAt: connected ? binding?.linkedAt.toISOString() ?? null : null,
      },
    };
  }

  async unlink(tenantId: string, userId: string): Promise<{ disconnected: boolean }> {
    const result = await this.prisma.telegramUserBinding.updateMany({
      where: { tenantId, userId, revokedAt: null }, data: { revokedAt: this.now() },
    });
    return { disconnected: result.count > 0 };
  }

  async queueTest(tenantId: string, userId: string): Promise<{ deliveryId: string; status: 'PENDING' }> {
    if (!this.options.botUsername || !this.options.queue) throw new Error('Telegram is not configured');
    const binding = await this.prisma.telegramUserBinding.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      select: { privateChatId: true, revokedAt: true },
    });
    if (!binding || binding.revokedAt) throw new Error('Telegram personal connection required');
    const destination = await this.prisma.telegramChat.findUnique({
      where: { tenantId_externalChatId_route: { tenantId, externalChatId: binding.privateChatId, route: 'BOT' } },
      select: { id: true },
    });
    if (!destination) throw new Error('Telegram personal connection required');

    const delivery = await this.prisma.telegramDelivery.create({ data: {
      tenantId,
      destinationId: destination.id,
      purpose: 'TEST',
      idempotencyKey: `test:${userId}:${randomUUID()}`,
      messageText: 'AutoSale підключено. Тестове сповіщення працює.',
      nextAttemptAt: this.now(),
    } });
    try {
      await this.options.queue.add(
        'telegram.deliver',
        { deliveryId: delivery.id },
        { jobId: `telegram:${delivery.id}`, attempts: 1, removeOnComplete: true, removeOnFail: true },
      );
    } catch {
      // PostgreSQL remains the source of truth; the worker reconciler retries the wake-up.
    }
    return { deliveryId: delivery.id, status: 'PENDING' };
  }

  async handleWebhook(input: unknown): Promise<'PROCESSED' | 'REPLAY' | 'IGNORED'> {
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) throw new Error('Invalid Telegram update');

    try {
      return await this.prisma.$transaction(async (transaction) => {
        await transaction.telegramWebhookUpdate.create({ data: { updateId: String(parsed.data.update_id) } });
        const result = await this.process(transaction, parsed.data);
        await transaction.telegramWebhookUpdate.update({
          where: { updateId: String(parsed.data.update_id) },
          data: { status: result, processedAt: this.now() },
        });
        return result === 'IGNORED' ? 'IGNORED' : 'PROCESSED';
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return 'REPLAY';
      throw error;
    }
  }

  private async process(transaction: Prisma.TransactionClient, update: TelegramUpdate): Promise<'PROCESSED' | 'IGNORED'> {
    if (update.message) return this.processStart(transaction, update.message);
    if (update.business_connection) return this.processBusinessConnection(transaction, update.business_connection);
    return 'IGNORED';
  }

  private async processStart(transaction: Prisma.TransactionClient, message: z.infer<typeof messageSchema>): Promise<'PROCESSED' | 'IGNORED'> {
    const command = /^\/start(?:@[A-Za-z][A-Za-z0-9_]{4,31})?\s+([A-Za-z0-9_-]{8,64})$/.exec(message.text.trim());
    if (!command?.[1]) return 'IGNORED';
    const tokenHash = createHash('sha256').update(command[1]).digest('hex');
    const attempt = await transaction.telegramLinkAttempt.findUnique({ where: { tokenHash } });
    if (!attempt || attempt.usedAt || attempt.expiresAt <= this.now()) return 'IGNORED';
    const expectedPurpose = message.chat.type === 'private' ? 'PERSONAL' : 'SUPPLIER_GROUP';
    if (attempt.purpose !== expectedPurpose) return 'IGNORED';
    const consumed = await transaction.telegramLinkAttempt.updateMany({
      where: { id: attempt.id, usedAt: null, expiresAt: { gt: this.now() } }, data: { usedAt: this.now() },
    });
    if (consumed.count !== 1) return 'IGNORED';

    const externalChatId = String(message.chat.id);
    await transaction.telegramChat.upsert({
      where: { tenantId_externalChatId_route: { tenantId: attempt.tenantId, externalChatId, route: 'BOT' } },
      create: { tenantId: attempt.tenantId, externalChatId, type: message.chat.type, title: message.chat.title ?? null, route: 'BOT', lastObservedAt: this.now() },
      update: { type: message.chat.type, title: message.chat.title ?? null, lastObservedAt: this.now() },
    });
    if (attempt.purpose === 'PERSONAL') {
      const displayName = [message.from.first_name, message.from.last_name].filter(Boolean).join(' ');
      await transaction.telegramUserBinding.upsert({
        where: { tenantId_userId: { tenantId: attempt.tenantId, userId: attempt.userId } },
        create: {
          tenantId: attempt.tenantId, userId: attempt.userId, telegramUserId: String(message.from.id),
          privateChatId: externalChatId, displayName, username: message.from.username ?? null,
        },
        update: {
          telegramUserId: String(message.from.id), privateChatId: externalChatId,
          displayName, username: message.from.username ?? null, linkedAt: this.now(), revokedAt: null,
        },
      });
    }
    return 'PROCESSED';
  }

  private async processBusinessConnection(transaction: Prisma.TransactionClient, connection: z.infer<typeof businessConnectionSchema>): Promise<'PROCESSED' | 'IGNORED'> {
    const bindings = await transaction.telegramUserBinding.findMany({
      where: { telegramUserId: String(connection.user.id), revokedAt: null }, select: { tenantId: true }, take: 2,
    });
    if (bindings.length !== 1 || !bindings[0]) return 'IGNORED';
    await transaction.telegramBusinessConnection.upsert({
      where: { tenantId_externalConnectionId: { tenantId: bindings[0].tenantId, externalConnectionId: connection.id } },
      create: {
        tenantId: bindings[0].tenantId, externalConnectionId: connection.id, telegramUserId: String(connection.user.id),
        rights: connection.rights as Prisma.InputJsonValue, enabled: connection.is_enabled,
        lastUpdatedAt: new Date(connection.date * 1_000),
      },
      update: {
        rights: connection.rights as Prisma.InputJsonValue, enabled: connection.is_enabled,
        lastUpdatedAt: new Date(connection.date * 1_000),
      },
    });
    return 'PROCESSED';
  }

}

function safeReturnPath(value: string | undefined): string {
  if (!value) return '/settings?tab=telegram';
  try {
    const url = new URL(value, 'https://autosale.local');
    if (url.origin !== 'https://autosale.local') return '/settings?tab=telegram';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/settings?tab=telegram';
  }
}
