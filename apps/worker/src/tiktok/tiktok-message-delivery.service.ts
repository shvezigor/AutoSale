import { randomUUID } from 'node:crypto';

import {
  assertTenantAcceptingMutations,
  type PrismaClient,
  TenantLifecycleFrozenError,
  withTenantTransaction,
} from '@autosale/database';
import { TikTokBusinessMessagingError } from '@autosale/integrations';

const LEASE_MS = 60_000;
const REPLY_WINDOW_MS = 48 * 60 * 60_000;
const RETRY_DELAYS_MS = [5_000, 15_000, 60_000, 5 * 60_000] as const;
const MAX_SAFE_RETRY_ATTEMPTS = 5;

export interface TikTokMessageDeliveryJob {
  tenantId: string;
  messageId: string;
}

export type TikTokMessageDeliveryResult =
  | 'SENT'
  | 'RETRY'
  | 'FAILED'
  | 'UNKNOWN'
  | 'IGNORED'
  | 'IGNORED_FROZEN';

interface TikTokTextClient {
  sendText(input: {
    accessToken: string;
    accountId: string;
    conversationId: string;
    text: string;
  }): Promise<{ messageId: string }>;
}

interface TikTokAccessTokens {
  getFreshAccessToken(tenantId: string, credentialGenerationId: string, now: Date): Promise<string>;
}

interface CurrentTikTokConnection {
  status: string;
  capabilities: unknown;
  encryptedAccessToken: string | null;
  encryptedRefreshToken: string | null;
  credentialGenerationId: string | null;
  externalAccountId: string;
}

export class TikTokMessageDeliveryService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly client: TikTokTextClient,
    private readonly tokens: TikTokAccessTokens,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async process(job: TikTokMessageDeliveryJob): Promise<TikTokMessageDeliveryResult> {
    const startedAt = this.now();
    const leaseId = randomUUID();
    let claimed: { count: number };
    try {
      claimed = await withTenantTransaction(this.prisma, job.tenantId, async (transaction) => {
        await assertTenantAcceptingMutations(transaction, job.tenantId, 'CONVERSATION_REPLY');
        return transaction.message.updateMany({
          where: {
            id: job.messageId,
            tenantId: job.tenantId,
            channel: 'TIKTOK',
            direction: 'OUTBOUND',
            deliveryStatus: 'PENDING',
            nextDeliveryAttemptAt: { lte: startedAt },
            deliveryLeaseId: null,
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
      });
    } catch (error) {
      if (!(error instanceof TenantLifecycleFrozenError)) throw error;
      await withTenantTransaction(this.prisma, job.tenantId, (transaction) => transaction.message.updateMany({
        where: {
          id: job.messageId, tenantId: job.tenantId, channel: 'TIKTOK',
          direction: 'OUTBOUND', deliveryStatus: 'PENDING',
        },
        data: {
          deliveryStatus: 'FAILED', deliveryErrorCode: 'TIKTOK_SEND_FAILED',
          nextDeliveryAttemptAt: null, deliveryLeaseId: null, deliveryLeaseExpiresAt: null,
        },
      }));
      return 'IGNORED_FROZEN';
    }
    if (claimed.count !== 1) return 'IGNORED';

    const [message, connection] = await withTenantTransaction(
      this.prisma,
      job.tenantId,
      (transaction) => Promise.all([
        transaction.message.findFirst({
          where: { id: job.messageId, tenantId: job.tenantId, deliveryLeaseId: leaseId },
          include: {
            conversation: {
              select: {
                externalConversationId: true,
                messages: {
                  where: { direction: 'INBOUND' },
                  orderBy: [{ sourceTimestamp: 'desc' }, { id: 'desc' }],
                  take: 1,
                  select: { sourceTimestamp: true },
                },
              },
            },
          },
        }),
        transaction.tikTokConnection.findUnique({ where: { tenantId: job.tenantId } }),
      ]),
    );
    if (!message || !message.text || !message.deliveryCredentialGenerationId) {
      await this.finish(job, leaseId, 'FAILED', 'TIKTOK_SEND_FAILED', null);
      return 'FAILED';
    }

    const generationId = message.deliveryCredentialGenerationId;
    if (
      !connection ||
      connection.credentialGenerationId !== generationId ||
      !connection.encryptedAccessToken ||
      !connection.encryptedRefreshToken
    ) {
      await this.finish(job, leaseId, 'FAILED', 'TIKTOK_RECONNECT_REQUIRED', null);
      return 'FAILED';
    }
    if (connection.status === 'INBOUND_ONLY' || !canSendText(connection.capabilities) || !withinReplyWindow(
      message.conversation.messages[0]?.sourceTimestamp ?? null,
      startedAt,
    )) {
      await this.finish(job, leaseId, 'FAILED', 'TIKTOK_REPLY_NOT_PERMITTED', null);
      return 'FAILED';
    }
    if (connection.status !== 'ACTIVE') {
      await this.finish(job, leaseId, 'FAILED', 'TIKTOK_RECONNECT_REQUIRED', null);
      return 'FAILED';
    }

    let accessToken: string;
    try {
      accessToken = await this.tokens.getFreshAccessToken(job.tenantId, generationId, startedAt);
    } catch (error) {
      if (isSafePreSendRetry(error)) {
        return this.scheduleSafeRetry(job, leaseId, message.deliveryAttempts, startedAt, 'TIKTOK_SEND_FAILED');
      }
      await this.markReconnectRequired(job, leaseId, generationId, startedAt);
      return 'FAILED';
    }

    let currentConnection: CurrentTikTokConnection | null;
    let currentLastInboundAt: Date | null;
    try {
      [currentConnection, currentLastInboundAt] = await withTenantTransaction(
        this.prisma,
        job.tenantId,
        async (transaction) => {
          await assertTenantAcceptingMutations(transaction, job.tenantId, 'CONVERSATION_REPLY');
          const [latestConnection, currentMessage] = await Promise.all([
            transaction.tikTokConnection.findUnique({ where: { tenantId: job.tenantId } }),
            transaction.message.findFirst({
              where: {
                id: job.messageId,
                tenantId: job.tenantId,
                channel: 'TIKTOK',
                deliveryStatus: 'SENDING',
                deliveryLeaseId: leaseId,
              },
              select: {
                conversation: {
                  select: {
                    messages: {
                      where: { direction: 'INBOUND' },
                      orderBy: [{ sourceTimestamp: 'desc' }, { id: 'desc' }],
                      take: 1,
                      select: { sourceTimestamp: true },
                    },
                  },
                },
              },
            }),
          ]);
          return [latestConnection, currentMessage?.conversation.messages[0]?.sourceTimestamp ?? null] as const;
        },
      );
    } catch (error) {
      if (!(error instanceof TenantLifecycleFrozenError)) throw error;
      await this.finish(job, leaseId, 'FAILED', 'TIKTOK_SEND_FAILED', null);
      return 'IGNORED_FROZEN';
    }
    if (
      !currentConnection ||
      currentConnection.credentialGenerationId !== generationId ||
      !currentConnection.encryptedAccessToken ||
      !currentConnection.encryptedRefreshToken
    ) {
      await this.finish(job, leaseId, 'FAILED', 'TIKTOK_RECONNECT_REQUIRED', null);
      return 'FAILED';
    }
    if (
      currentConnection.status === 'INBOUND_ONLY' ||
      !canSendText(currentConnection.capabilities) ||
      !withinReplyWindow(currentLastInboundAt, this.now())
    ) {
      await this.finish(job, leaseId, 'FAILED', 'TIKTOK_REPLY_NOT_PERMITTED', null);
      return 'FAILED';
    }
    if (currentConnection.status !== 'ACTIVE') {
      await this.finish(job, leaseId, 'FAILED', 'TIKTOK_RECONNECT_REQUIRED', null);
      return 'FAILED';
    }

    let sent: { messageId: string };
    try {
      sent = await this.client.sendText({
        accessToken,
        accountId: currentConnection.externalAccountId,
        conversationId: message.conversation.externalConversationId,
        text: message.text,
      });
    } catch (error) {
      if (!(error instanceof TikTokBusinessMessagingError)) {
        await this.finish(job, leaseId, 'UNKNOWN', 'TIKTOK_DELIVERY_UNKNOWN', null);
        return 'UNKNOWN';
      }
      if (error.status === null || error.status >= 500) {
        await this.finish(job, leaseId, 'UNKNOWN', 'TIKTOK_DELIVERY_UNKNOWN', null);
        return 'UNKNOWN';
      }
      if (error.status === 401) {
        await this.markReconnectRequired(job, leaseId, generationId, startedAt);
        return 'FAILED';
      }
      if (error.status === 403) {
        await this.finish(job, leaseId, 'FAILED', 'TIKTOK_REPLY_NOT_PERMITTED', null);
        return 'FAILED';
      }
      if (error.retryable) {
        const code = error.status === 429 ? 'TIKTOK_RATE_LIMITED' : 'TIKTOK_SEND_FAILED';
        return this.scheduleSafeRetry(job, leaseId, message.deliveryAttempts, startedAt, code);
      }
      await this.finish(job, leaseId, 'FAILED', 'TIKTOK_SEND_FAILED', null);
      return 'FAILED';
    }

    const updated = await this.finish(job, leaseId, 'SENT', null, null, sent.messageId);
    return updated ? 'SENT' : 'IGNORED';
  }

  private async scheduleSafeRetry(
    job: TikTokMessageDeliveryJob,
    leaseId: string,
    attempts: number,
    now: Date,
    errorCode: 'TIKTOK_RATE_LIMITED' | 'TIKTOK_SEND_FAILED',
  ): Promise<'RETRY' | 'FAILED'> {
    if (attempts >= MAX_SAFE_RETRY_ATTEMPTS) {
      await this.finish(job, leaseId, 'FAILED', errorCode, null);
      return 'FAILED';
    }
    const delay = RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)]!;
    await this.finish(job, leaseId, 'PENDING', errorCode, new Date(now.getTime() + delay));
    return 'RETRY';
  }

  private async finish(
    job: TikTokMessageDeliveryJob,
    leaseId: string,
    deliveryStatus: 'PENDING' | 'SENT' | 'FAILED' | 'UNKNOWN',
    deliveryErrorCode: string | null,
    nextDeliveryAttemptAt: Date | null,
    providerMessageId?: string,
  ): Promise<boolean> {
    const updated = await withTenantTransaction(this.prisma, job.tenantId, (transaction) => transaction.message.updateMany({
      where: {
        id: job.messageId, tenantId: job.tenantId,
        channel: 'TIKTOK', deliveryStatus: 'SENDING', deliveryLeaseId: leaseId,
      },
      data: {
        deliveryStatus, deliveryErrorCode, nextDeliveryAttemptAt,
        ...(providerMessageId ? { providerMessageId } : {}),
        deliveryLeaseId: null, deliveryLeaseExpiresAt: null,
      },
    }));
    return updated.count === 1;
  }

  private async markReconnectRequired(
    job: TikTokMessageDeliveryJob,
    leaseId: string,
    generationId: string,
    now: Date,
  ): Promise<void> {
    await withTenantTransaction(this.prisma, job.tenantId, async (transaction) => {
      await transaction.message.updateMany({
        where: {
          id: job.messageId, tenantId: job.tenantId,
          channel: 'TIKTOK', deliveryStatus: 'SENDING', deliveryLeaseId: leaseId,
        },
        data: {
          deliveryStatus: 'FAILED', deliveryErrorCode: 'TIKTOK_RECONNECT_REQUIRED',
          nextDeliveryAttemptAt: null, deliveryLeaseId: null, deliveryLeaseExpiresAt: null,
        },
      });
      await transaction.tikTokConnection.updateMany({
        where: { tenantId: job.tenantId, credentialGenerationId: generationId },
        data: {
          status: 'REAUTH_REQUIRED', lastErrorCode: 'TIKTOK_RECONNECT_REQUIRED',
          lastVerifiedAt: now, refreshLeaseId: null, refreshLeaseExpiresAt: null,
        },
      });
    });
  }
}

function canSendText(capabilities: unknown): boolean {
  return typeof capabilities === 'object' && capabilities !== null &&
    'sendText' in capabilities && capabilities.sendText === true;
}

function withinReplyWindow(lastInboundAt: Date | null, now: Date): boolean {
  return lastInboundAt instanceof Date && now.getTime() - lastInboundAt.getTime() <= REPLY_WINDOW_MS;
}

function isSafePreSendRetry(error: unknown): boolean {
  return error instanceof TikTokBusinessMessagingError && error.retryable;
}
