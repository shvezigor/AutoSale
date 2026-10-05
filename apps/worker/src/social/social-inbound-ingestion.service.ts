import {
  assertTenantAcceptingMutations,
  type Prisma,
  type PrismaClient,
  TenantLifecycleFrozenError,
  withTenantTransaction,
} from '@autosale/database';

import { MediaCopyError } from '../instagram/media-copy.service.js';
import type { NormalizedInboundMessage, SocialChannel } from './normalized-inbound-message.js';

export interface SocialMediaCopier {
  copy(input: { tenantId: string; sourceUrl: string; channel?: SocialChannel }): Promise<{
    key: string;
    etag: string;
    checksum: string;
    contentType: string;
  }>;
}

export interface SocialOrderTriggerProcessor {
  processIfTriggered(tenantId: string, messageId: string): Promise<unknown>;
}

export interface SocialReplyDraftScheduler {
  schedule(tenantId: string, messageId: string): Promise<unknown>;
}

export class SocialInboundIngestionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly media: SocialMediaCopier,
    private readonly orders?: SocialOrderTriggerProcessor,
    private readonly replyDrafts?: SocialReplyDraftScheduler,
  ) {}

  async process(
    tenantId: string,
    eventId: string,
    normalize: (payload: unknown) => NormalizedInboundMessage[],
  ): Promise<'PROCESSED' | 'IGNORED_FROZEN'> {
    try {
      await this.processAccepted(tenantId, eventId, normalize);
      return 'PROCESSED';
    } catch (error) {
      if (!(error instanceof TenantLifecycleFrozenError)) throw error;
      await withTenantTransaction(this.prisma, tenantId, (transaction) => transaction.webhookEvent.updateMany({
        where: { id: eventId, tenantId },
        data: { status: 'PROCESSED', processedAt: new Date() },
      }));
      return 'IGNORED_FROZEN';
    }
  }

  private async processAccepted(
    tenantId: string,
    eventId: string,
    normalize: (payload: unknown) => NormalizedInboundMessage[],
  ): Promise<void> {
    const event = await withTenantTransaction(this.prisma, tenantId, async (transaction) => {
      await assertTenantAcceptingMutations(transaction, tenantId, 'ORDER_RECOGNITION');
      return transaction.webhookEvent.findUniqueOrThrow({ where: { id: eventId } });
    });
    const messages = normalize(event.payload);

    for (const normalized of messages) {
      const persisted = await withTenantTransaction(this.prisma, event.tenantId, async (transaction) => {
        await assertTenantAcceptingMutations(transaction, event.tenantId, 'ORDER_RECOGNITION');
        const profileId = normalized.channel === 'INSTAGRAM'
          ? (await transaction.instagramCustomerProfile.upsert({
              where: {
                tenantId_participantId: {
                  tenantId: event.tenantId,
                  participantId: normalized.participantId,
                },
              },
              create: { tenantId: event.tenantId, participantId: normalized.participantId },
              update: {},
            })).id
          : null;

        const conversation = await transaction.conversation.upsert({
          where: {
            tenantId_channel_externalConversationId: {
              tenantId: event.tenantId,
              channel: normalized.channel,
              externalConversationId: normalized.externalConversationId,
            },
          },
          update: { participantId: normalized.participantId, profileId },
          create: {
            tenantId: event.tenantId,
            channel: normalized.channel,
            externalConversationId: normalized.externalConversationId,
            participantId: normalized.participantId,
            profileId,
            lastMessageAt: normalized.sourceTimestamp,
          },
        });

        await transaction.conversation.updateMany({
          where: { id: conversation.id, lastMessageAt: { lt: normalized.sourceTimestamp } },
          data: { lastMessageAt: normalized.sourceTimestamp },
        });

        const reconciled = normalized.direction === 'OUTBOUND'
          ? await findOutboundEchoCandidate(transaction, {
              tenantId: event.tenantId,
              conversationId: conversation.id,
              providerMessageId: normalized.externalMessageId,
              text: normalized.text,
              sourceTimestamp: normalized.sourceTimestamp,
            })
          : null;

        let message;
        let wasCreated = false;
        if (reconciled) {
          message = await transaction.message.update({
            where: { id: reconciled.id },
            data: {
              rawEventId: event.id,
              providerMessageId: normalized.externalMessageId,
              deliveryStatus: 'SENT',
              deliveryErrorCode: null,
              deliveryLeaseId: null,
              deliveryLeaseExpiresAt: null,
              nextDeliveryAttemptAt: null,
            },
          });
        } else {
          const created = await transaction.message.createMany({
            data: [{
              tenantId: event.tenantId,
              conversationId: conversation.id,
              rawEventId: event.id,
              channel: normalized.channel,
              externalMessageId: normalized.externalMessageId,
              direction: normalized.direction,
              senderId: normalized.senderId,
              text: normalized.text,
              sourceTimestamp: normalized.sourceTimestamp,
            }],
            skipDuplicates: true,
          });
          wasCreated = created.count === 1;
          message = await transaction.message.findUniqueOrThrow({
            where: {
              tenantId_channel_externalMessageId: {
                tenantId: event.tenantId,
                channel: normalized.channel,
                externalMessageId: normalized.externalMessageId,
              },
            },
          });
        }

        if (normalized.attachments.length > 0) {
          const existingAttachments = await transaction.attachment.findMany({
            where: {
              messageId: message.id,
              originalUrl: { in: normalized.attachments.map((attachment) => attachment.sourceUrl) },
            },
            select: { originalUrl: true },
          });
          const existingUrls = new Set(existingAttachments.map((attachment) => attachment.originalUrl));
          await transaction.attachment.createMany({
            data: normalized.attachments
              .filter((attachment) => !existingUrls.has(attachment.sourceUrl))
              .map((attachment) => ({
                messageId: message.id,
                type: attachment.type,
                originalUrl: attachment.sourceUrl,
                copyStatus: attachment.type === 'IMAGE' || attachment.type === 'VIDEO'
                  ? 'PENDING'
                  : 'NOT_REQUIRED',
              })),
            skipDuplicates: true,
          });
        }

        return {
          messageId: message.id,
          wasCreated,
          attachments: await transaction.attachment.findMany({
            where: {
              messageId: message.id,
              type: { in: ['IMAGE', 'VIDEO'] },
              OR: [
                { copyStatus: { in: ['PENDING', 'RETRYABLE_FAILURE'] } },
                {
                  copyStatus: 'FAILED',
                  failureSummary: {
                    in: ['Unsupported media type: video/mp4', 'Media exceeds the configured byte ceiling'],
                  },
                },
              ],
            },
          }),
        };
      });

      if (normalized.direction === 'INBOUND') {
        await this.replyDrafts?.schedule(event.tenantId, persisted.messageId);
      }

      for (const attachment of persisted.attachments) {
        try {
          await withTenantTransaction(this.prisma, event.tenantId, (transaction) =>
            assertTenantAcceptingMutations(transaction, event.tenantId, 'ORDER_RECOGNITION'));
          const copied = await this.media.copy({
            tenantId: event.tenantId,
            sourceUrl: attachment.originalUrl,
            ...(normalized.channel === 'INSTAGRAM' ? {} : { channel: normalized.channel }),
          });
          await withTenantTransaction(this.prisma, event.tenantId, (transaction) => transaction.attachment.update({
            where: { id: attachment.id },
            data: {
              type: copied.contentType === 'video/mp4' ? 'VIDEO' : 'IMAGE',
              copyStatus: 'COPIED',
              storageKey: copied.key,
              checksum: copied.checksum,
              failureSummary: null,
            },
          }));
        } catch (error) {
          const retryable = !(error instanceof MediaCopyError) || error.retryable;
          await withTenantTransaction(this.prisma, event.tenantId, (transaction) => transaction.attachment.update({
            where: { id: attachment.id },
            data: {
              copyStatus: retryable ? 'RETRYABLE_FAILURE' : 'FAILED',
              failureSummary: summarizeError(error),
            },
          }));
          if (retryable) throw error;
        }
      }

      if (persisted.wasCreated || (normalized.channel === 'INSTAGRAM' && normalized.direction === 'OUTBOUND')) {
        await withTenantTransaction(this.prisma, event.tenantId, (transaction) =>
          assertTenantAcceptingMutations(transaction, event.tenantId, 'ORDER_RECOGNITION'));
        await this.orders?.processIfTriggered(event.tenantId, persisted.messageId);
      }
    }

    await withTenantTransaction(this.prisma, event.tenantId, (transaction) => transaction.webhookEvent.update({
      where: { id: event.id },
      data: { status: 'PROCESSED', processedAt: new Date() },
    }));
  }
}

async function findOutboundEchoCandidate(
  transaction: Prisma.TransactionClient,
  input: {
    tenantId: string;
    conversationId: string;
    providerMessageId: string;
    text: string | null;
    sourceTimestamp: Date;
  },
): Promise<{ id: string } | null> {
  const providerMatch = await transaction.message.findFirst({
    where: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      direction: 'OUTBOUND',
      providerMessageId: input.providerMessageId,
    },
    select: { id: true },
  });
  if (providerMatch) return providerMatch;
  if (input.text === null) return null;

  const candidates = await transaction.message.findMany({
    where: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      direction: 'OUTBOUND',
      clientIdempotencyKey: { not: null },
      providerMessageId: null,
      sourceTimestamp: {
        gte: new Date(input.sourceTimestamp.getTime() - 30_000),
        lte: new Date(input.sourceTimestamp.getTime() + 30_000),
      },
    },
    select: { id: true, text: true },
    take: 3,
  });
  const expectedText = normalizeEchoText(input.text);
  const matches = candidates.filter((candidate) =>
    candidate.text !== null && normalizeEchoText(candidate.text) === expectedText);
  return matches.length === 1 ? { id: matches[0]!.id } : null;
}

function normalizeEchoText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function summarizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown media copy failure';
  return message.slice(0, 500);
}
