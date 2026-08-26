import type { PrismaClient } from '@autosale/database';

import { MediaCopyError } from './media-copy.service.js';
import { normalizeInstagramEvent } from './instagram-normalizer.js';

interface MediaCopier {
  copy(input: { tenantId: string; sourceUrl: string }): Promise<{
    key: string;
    etag: string;
    checksum: string;
    contentType: string;
  }>;
}

interface OrderTriggerProcessor {
  processIfTriggered(messageId: string): Promise<unknown>;
}

export class InstagramProcessor {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly media: MediaCopier,
    private readonly orders?: OrderTriggerProcessor,
  ) {}

  async process(eventId: string): Promise<void> {
    const event = await this.prisma.webhookEvent.findUniqueOrThrow({ where: { id: eventId } });
    const messages = normalizeInstagramEvent(event.payload);

    for (const normalized of messages) {
      const persisted = await this.prisma.$transaction(async (transaction) => {
        const conversation = await transaction.conversation.upsert({
          where: {
            tenantId_channel_externalConversationId: {
              tenantId: event.tenantId,
              channel: 'INSTAGRAM',
              externalConversationId: normalized.externalConversationId,
            },
          },
          update: { participantId: normalized.externalConversationId },
          create: {
            tenantId: event.tenantId,
            channel: 'INSTAGRAM',
            externalConversationId: normalized.externalConversationId,
            participantId: normalized.externalConversationId,
            lastMessageAt: normalized.sourceTimestamp,
          },
        });

        await transaction.conversation.updateMany({
          where: { id: conversation.id, lastMessageAt: { lt: normalized.sourceTimestamp } },
          data: { lastMessageAt: normalized.sourceTimestamp },
        });

        const created = await transaction.message.createMany({
          data: [
            {
              tenantId: event.tenantId,
              conversationId: conversation.id,
              rawEventId: event.id,
              channel: 'INSTAGRAM',
              externalMessageId: normalized.externalMessageId,
              direction: normalized.direction,
              senderId: normalized.senderId,
              text: normalized.text,
              sourceTimestamp: normalized.sourceTimestamp,
            },
          ],
          skipDuplicates: true,
        });

        const message = await transaction.message.findUniqueOrThrow({
          where: {
            tenantId_channel_externalMessageId: {
              tenantId: event.tenantId,
              channel: 'INSTAGRAM',
              externalMessageId: normalized.externalMessageId,
            },
          },
        });

        if (created.count === 1 && normalized.attachments.length > 0) {
          await transaction.attachment.createMany({
            data: normalized.attachments.map((attachment) => ({
              messageId: message.id,
              type: attachment.type,
              originalUrl: attachment.sourceUrl,
            })),
          });
        }

        return {
          messageId: message.id,
          wasCreated: created.count === 1,
          attachments: await transaction.attachment.findMany({
            where: { messageId: message.id, copyStatus: { in: ['PENDING', 'RETRYABLE_FAILURE'] } },
          }),
        };
      });

      for (const attachment of persisted.attachments) {
        try {
          const copied = await this.media.copy({
            tenantId: event.tenantId,
            sourceUrl: attachment.originalUrl,
          });
          await this.prisma.attachment.update({
            where: { id: attachment.id },
            data: {
              copyStatus: 'COPIED',
              storageKey: copied.key,
              checksum: copied.checksum,
              failureSummary: null,
            },
          });
        } catch (error) {
          const retryable = !(error instanceof MediaCopyError) || error.retryable;
          await this.prisma.attachment.update({
            where: { id: attachment.id },
            data: {
              copyStatus: retryable ? 'RETRYABLE_FAILURE' : 'FAILED',
              failureSummary: summarizeError(error),
            },
          });
          if (retryable) throw error;
        }
      }

      if (persisted.wasCreated) {
        await this.orders?.processIfTriggered(persisted.messageId);
      }
    }

    await this.prisma.webhookEvent.update({
      where: { id: event.id },
      data: { status: 'PROCESSED', processedAt: new Date() },
    });
  }
}

function summarizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown media copy failure';
  return message.slice(0, 500);
}
