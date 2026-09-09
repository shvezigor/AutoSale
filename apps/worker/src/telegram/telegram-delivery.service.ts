import { randomUUID } from 'node:crypto';

import type { TelegramDeliveryJob } from '@autosale/contracts';
import type { PrismaClient } from '@autosale/database';
import { TelegramBotError } from '@autosale/integrations';

const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 5;

interface TelegramTextClient {
  sendText(input: {
    chatId: string;
    text: string;
    businessConnectionId?: string;
  }): Promise<{ messageId: string; chatId: string }>;
}

export type TelegramDeliveryResult = 'SUCCEEDED' | 'RETRY' | 'FAILED' | 'IGNORED';

export class TelegramDeliveryService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly telegram: TelegramTextClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async process(job: TelegramDeliveryJob): Promise<TelegramDeliveryResult> {
    const startedAt = this.now();
    const leaseId = randomUUID();
    const claimed = await this.prisma.telegramDelivery.updateMany({
      where: {
        id: job.deliveryId,
        OR: [
          { status: { in: ['PENDING', 'RETRYABLE'] }, nextAttemptAt: { lte: startedAt } },
          { status: 'PROCESSING', leaseExpiresAt: { lte: startedAt } },
        ],
        AND: [{ OR: [{ leaseId: null }, { leaseExpiresAt: { lte: startedAt } }] }],
      },
      data: {
        status: 'PROCESSING',
        attempts: { increment: 1 },
        lastAttemptAt: startedAt,
        leaseId,
        leaseExpiresAt: new Date(startedAt.getTime() + LEASE_MS),
        lastErrorCode: null,
      },
    });
    if (claimed.count !== 1) return 'IGNORED';

    const delivery = await this.prisma.telegramDelivery.findFirst({
      where: { id: job.deliveryId, status: 'PROCESSING', leaseId },
      include: { destination: true },
    });
    if (!delivery) return 'IGNORED';

    if (delivery.destination.route === 'BUSINESS' && !delivery.destination.businessConnectionId) {
      const updated = await this.finish(job.deliveryId, leaseId, {
        status: 'FAILED',
        lastErrorCode: 'TELEGRAM_DESTINATION_INVALID',
        completedAt: startedAt,
      });
      return updated ? 'FAILED' : 'IGNORED';
    }

    const input = {
      chatId: delivery.destination.externalChatId,
      text: delivery.messageText,
      ...(delivery.destination.route === 'BUSINESS' && delivery.destination.businessConnectionId
        ? { businessConnectionId: delivery.destination.businessConnectionId }
        : {}),
    };
    let sent: { messageId: string; chatId: string };
    try {
      sent = await this.telegram.sendText(input);
    } catch (error) {
      if (error instanceof TelegramBotError && error.code === 'RATE_LIMITED') {
        const exhausted = delivery.attempts >= MAX_ATTEMPTS;
        const retrySeconds = Math.min(3_600, Math.max(1, error.retryAfterSeconds ?? 30));
        const updated = await this.finish(job.deliveryId, leaseId, {
          status: exhausted ? 'FAILED' : 'RETRYABLE',
          nextAttemptAt: exhausted ? startedAt : new Date(startedAt.getTime() + retrySeconds * 1_000),
          lastErrorCode: 'TELEGRAM_RATE_LIMITED',
          completedAt: exhausted ? startedAt : null,
        });
        if (!updated) return 'IGNORED';
        return exhausted ? 'FAILED' : 'RETRY';
      }
      const updated = await this.finish(job.deliveryId, leaseId, {
        status: 'FAILED',
        lastErrorCode: telegramFailureCode(error),
        completedAt: startedAt,
      });
      return updated ? 'FAILED' : 'IGNORED';
    }

    if (sent.chatId !== delivery.destination.externalChatId) {
      const updated = await this.finish(job.deliveryId, leaseId, {
        status: 'FAILED',
        lastErrorCode: 'TELEGRAM_DESTINATION_MISMATCH',
        completedAt: startedAt,
      });
      return updated ? 'FAILED' : 'IGNORED';
    }

    const completed = await this.finish(job.deliveryId, leaseId, {
      status: 'SUCCEEDED',
      providerMessageId: sent.messageId,
      completedAt: startedAt,
      lastErrorCode: null,
    });
    return completed ? 'SUCCEEDED' : 'IGNORED';
  }

  private async finish(
    deliveryId: string,
    leaseId: string,
    data: {
      status: 'SUCCEEDED' | 'RETRYABLE' | 'FAILED';
      providerMessageId?: string;
      nextAttemptAt?: Date;
      lastErrorCode: string | null;
      completedAt: Date | null;
    },
  ): Promise<boolean> {
    const updated = await this.prisma.telegramDelivery.updateMany({
      where: { id: deliveryId, status: 'PROCESSING', leaseId },
      data: { ...data, leaseId: null, leaseExpiresAt: null },
    });
    return updated.count === 1;
  }
}

function telegramFailureCode(error: unknown): string {
  if (!(error instanceof TelegramBotError)) return 'TELEGRAM_SEND_FAILED';
  if (error.code === 'NETWORK' || error.code === 'TIMEOUT' || error.code === 'PROVIDER_ERROR') {
    return 'TELEGRAM_DELIVERY_UNKNOWN';
  }
  return `TELEGRAM_${error.code}`;
}
