import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@autosale/database';
import { CredentialCipher, MetaInstagramError } from '@autosale/integrations';

const LEASE_MS = 60_000;
const RATE_LIMIT_DELAYS_MS = [5_000, 15_000, 60_000, 5 * 60_000] as const;
const MAX_RATE_LIMIT_ATTEMPTS = 5;

export interface InstagramMessageDeliveryJob {
  tenantId: string;
  messageId: string;
}

export type InstagramMessageDeliveryResult = 'SENT' | 'RETRY' | 'FAILED' | 'UNKNOWN' | 'IGNORED';

interface InstagramTextClient {
  sendText(
    recipientId: string,
    text: string,
    accessToken: string,
  ): Promise<{ recipientId: string; messageId: string }>;
}

interface OrderTriggerProcessor {
  processIfTriggered(messageId: string): Promise<unknown>;
}

export class InstagramMessageDeliveryService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly meta: InstagramTextClient,
    private readonly cipher: CredentialCipher,
    private readonly orders: OrderTriggerProcessor,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async process(job: InstagramMessageDeliveryJob): Promise<InstagramMessageDeliveryResult> {
    const startedAt = this.now();
    const leaseId = randomUUID();
    const claimed = await this.prisma.message.updateMany({
      where: {
        id: job.messageId,
        tenantId: job.tenantId,
        direction: 'OUTBOUND',
        AND: [
          {
            OR: [
              { deliveryStatus: 'PENDING', nextDeliveryAttemptAt: { lte: startedAt } },
              { deliveryStatus: 'SENDING', deliveryLeaseExpiresAt: { lte: startedAt } },
            ],
          },
          {
            OR: [
              { deliveryLeaseId: null },
              { deliveryLeaseExpiresAt: { lte: startedAt } },
            ],
          },
        ],
      },
      data: {
        deliveryStatus: 'SENDING',
        deliveryAttempts: { increment: 1 },
        deliveryLeaseId: leaseId,
        deliveryLeaseExpiresAt: new Date(startedAt.getTime() + LEASE_MS),
        nextDeliveryAttemptAt: null,
        lastDeliveryAttemptAt: startedAt,
        deliveryErrorCode: null,
      },
    });
    if (claimed.count !== 1) return 'IGNORED';

    const message = await this.prisma.message.findFirst({
      where: { id: job.messageId, tenantId: job.tenantId, deliveryLeaseId: leaseId },
      include: { conversation: { select: { participantId: true } } },
    });
    if (!message || message.text === null) {
      await this.finish(job, leaseId, {
        deliveryStatus: 'FAILED',
        deliveryErrorCode: 'INSTAGRAM_SEND_FAILED',
        nextDeliveryAttemptAt: null,
      });
      return 'FAILED';
    }

    const connection = await this.prisma.instagramConnection.findFirst({
      where: {
        tenantId: job.tenantId,
        status: 'ACTIVE',
        encryptedAccessToken: { not: null },
        tokenExpiresAt: { gt: startedAt },
      },
      select: {
        id: true,
        encryptedAccessToken: true,
        credentialGenerationId: true,
      },
    });
    if (!connection?.encryptedAccessToken) {
      await this.finish(job, leaseId, {
        deliveryStatus: 'FAILED',
        deliveryErrorCode: 'INSTAGRAM_RECONNECT_REQUIRED',
        nextDeliveryAttemptAt: null,
      });
      return 'FAILED';
    }

    let accessToken: string;
    try {
      accessToken = this.cipher.decrypt(connection.encryptedAccessToken);
    } catch {
      await this.markReconnectRequired(job, leaseId, connection, startedAt);
      return 'FAILED';
    }

    let sent: { recipientId: string; messageId: string };
    try {
      sent = await this.meta.sendText(
        message.conversation.participantId,
        message.text,
        accessToken,
      );
    } catch (error) {
      if (!(error instanceof MetaInstagramError)) {
        await this.finish(job, leaseId, {
          deliveryStatus: 'UNKNOWN',
          deliveryErrorCode: 'INSTAGRAM_DELIVERY_UNKNOWN',
          nextDeliveryAttemptAt: null,
        });
        return 'UNKNOWN';
      }

      if (isReconnectError(error)) {
        await this.markReconnectRequired(job, leaseId, connection, startedAt);
        return 'FAILED';
      }
      if (error.status === 429) {
        if (message.deliveryAttempts >= MAX_RATE_LIMIT_ATTEMPTS) {
          await this.finish(job, leaseId, {
            deliveryStatus: 'FAILED',
            deliveryErrorCode: 'INSTAGRAM_RATE_LIMITED',
            nextDeliveryAttemptAt: null,
          });
          return 'FAILED';
        }
        const retryDelay = RATE_LIMIT_DELAYS_MS[Math.min(
          message.deliveryAttempts - 1,
          RATE_LIMIT_DELAYS_MS.length - 1,
        )]!;
        await this.finish(job, leaseId, {
          deliveryStatus: 'PENDING',
          deliveryErrorCode: 'INSTAGRAM_RATE_LIMITED',
          nextDeliveryAttemptAt: new Date(startedAt.getTime() + retryDelay),
        });
        return 'RETRY';
      }
      if (error.status === null || error.status >= 500) {
        await this.finish(job, leaseId, {
          deliveryStatus: 'UNKNOWN',
          deliveryErrorCode: 'INSTAGRAM_DELIVERY_UNKNOWN',
          nextDeliveryAttemptAt: null,
        });
        return 'UNKNOWN';
      }

      await this.finish(job, leaseId, {
        deliveryStatus: 'FAILED',
        deliveryErrorCode: 'INSTAGRAM_SEND_FAILED',
        nextDeliveryAttemptAt: null,
      });
      return 'FAILED';
    }

    const updated = await this.finish(job, leaseId, {
      deliveryStatus: 'SENT',
      providerMessageId: sent.messageId,
      deliveryErrorCode: null,
      nextDeliveryAttemptAt: null,
    });
    if (!updated) return 'IGNORED';
    await this.orders.processIfTriggered(job.messageId);
    return 'SENT';
  }

  private async finish(
    job: InstagramMessageDeliveryJob,
    leaseId: string,
    data: {
      deliveryStatus: 'PENDING' | 'SENT' | 'FAILED' | 'UNKNOWN';
      deliveryErrorCode: string | null;
      nextDeliveryAttemptAt: Date | null;
      providerMessageId?: string;
    },
  ): Promise<boolean> {
    const updated = await this.prisma.message.updateMany({
      where: {
        id: job.messageId,
        tenantId: job.tenantId,
        deliveryStatus: 'SENDING',
        deliveryLeaseId: leaseId,
      },
      data: {
        ...data,
        deliveryLeaseId: null,
        deliveryLeaseExpiresAt: null,
      },
    });
    return updated.count === 1;
  }

  private async markReconnectRequired(
    job: InstagramMessageDeliveryJob,
    leaseId: string,
    connection: { id: string; credentialGenerationId: string | null },
    now: Date,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.message.updateMany({
        where: {
          id: job.messageId,
          tenantId: job.tenantId,
          deliveryStatus: 'SENDING',
          deliveryLeaseId: leaseId,
        },
        data: {
          deliveryStatus: 'FAILED',
          deliveryErrorCode: 'INSTAGRAM_RECONNECT_REQUIRED',
          nextDeliveryAttemptAt: null,
          deliveryLeaseId: null,
          deliveryLeaseExpiresAt: null,
        },
      }),
      this.prisma.instagramConnection.updateMany({
        where: {
          id: connection.id,
          tenantId: job.tenantId,
          credentialGenerationId: connection.credentialGenerationId,
        },
        data: {
          status: 'REAUTH_REQUIRED',
          lastErrorCode: 'INSTAGRAM_RECONNECT_REQUIRED',
          lastVerifiedAt: now,
        },
      }),
    ]);
  }
}

function isReconnectError(error: MetaInstagramError): boolean {
  return error.providerCode === 190 || error.providerCode === 10 || error.providerCode === 200;
}
