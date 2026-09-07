import { randomUUID } from 'node:crypto';

import type {
  ConversationDetailResponse,
  ConversationListResponse,
  ConversationMessage,
  ConversationQuery,
  OutboundMessageInput,
} from '@autosale/contracts/conversations';
import type { PrismaClient } from '@autosale/database';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';

interface ConversationCursor {
  lastMessageAt: string;
  id: string;
}

export interface InstagramMessageQueue {
  add(
    name: 'instagram.message.send',
    data: { tenantId: string; messageId: string },
    options: { jobId: string; attempts: 1; removeOnComplete: true; removeOnFail: true },
  ): Promise<unknown>;
}

interface DeliveryConnection {
  status: string;
  encryptedAccessToken: string | null;
  tokenExpiresAt: Date | null;
}

export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly queue: InstagramMessageQueue,
  ) {}

  async list(tenantId: string, query: ConversationQuery): Promise<ConversationListResponse> {
    const limit = Math.min(query.limit, 50);
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const rows = await this.prisma.conversation.findMany({
      where: {
        tenantId,
        ...(cursor
          ? {
              OR: [
                { lastMessageAt: { lt: new Date(cursor.lastMessageAt) } },
                { lastMessageAt: new Date(cursor.lastMessageAt), id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: {
        profile: {
          select: {
            id: true,
            displayName: true,
            username: true,
            avatarStorageKey: true,
            avatarChecksum: true,
            refreshVersion: true,
          },
        },
        messages: {
          orderBy: [{ sourceTimestamp: 'desc' }, { id: 'desc' }],
          take: 1,
          select: { text: true },
        },
      },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);

    return {
      items: page.map((conversation) => ({
        id: conversation.id,
        channel: 'INSTAGRAM',
        participantName: participantName(conversation.profile, conversation.displayName),
        participantUsername: conversation.profile?.username ?? null,
        participantAvatarUrl: profileAvatarUrl(conversation.profile),
        lastMessagePreview: conversation.messages[0]?.text ?? null,
        lastMessageAt: conversation.lastMessageAt.toISOString(),
      })),
      nextCursor:
        hasMore && last
          ? encodeCursor({ lastMessageAt: last.lastMessageAt.toISOString(), id: last.id })
          : null,
    };
  }

  async detail(tenantId: string, id: string): Promise<ConversationDetailResponse> {
    const [conversation, connection] = await Promise.all([
      this.prisma.conversation.findFirst({
        where: { id, tenantId },
        include: {
          profile: {
            select: {
              id: true,
              displayName: true,
              username: true,
              avatarStorageKey: true,
              avatarChecksum: true,
              refreshVersion: true,
            },
          },
          messages: {
            orderBy: [{ sourceTimestamp: 'asc' }, { id: 'asc' }],
            include: { attachments: { orderBy: { createdAt: 'asc' } } },
          },
        },
      }),
      this.prisma.instagramConnection.findUnique({ where: { tenantId } }),
    ]);

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    return {
      id: conversation.id,
      channel: 'INSTAGRAM',
      participantName: participantName(conversation.profile, conversation.displayName),
      participantUsername: conversation.profile?.username ?? null,
      participantAvatarUrl: profileAvatarUrl(conversation.profile),
      replyCapability: replyCapability(connection, new Date()),
      messages: conversation.messages.map((message) => mapMessage(
        message,
        isDeliveryConnectionActive(connection, new Date()),
      )),
    };
  }

  async send(
    tenantId: string,
    actorUserId: string,
    conversationId: string,
    input: OutboundMessageInput,
  ): Promise<ConversationMessage> {
    const now = new Date();
    const text = input.text.trim();
    const result = await this.prisma.$transaction(async (transaction) => {
      const conversation = await transaction.conversation.findFirst({
        where: { id: conversationId, tenantId, channel: 'INSTAGRAM' },
      });
      if (!conversation) throw new NotFoundException('Conversation not found');

      const connection = await transaction.instagramConnection.findUnique({ where: { tenantId } });
      if (!isDeliveryConnectionActive(connection, now)) {
        throw new BadRequestException('Instagram connection is not ready for replies');
      }

      const existing = await transaction.message.findFirst({
        where: { tenantId, clientIdempotencyKey: input.idempotencyKey },
        include: { attachments: { orderBy: { createdAt: 'asc' } } },
      });
      if (existing) {
        if (existing.conversationId !== conversationId || existing.text !== text) {
          throw new BadRequestException('Idempotency key was already used');
        }
        return { message: existing, created: false, connectionActive: true };
      }

      const acceptedInWindow = await transaction.message.count({
        where: {
          tenantId,
          sentByUserId: actorUserId,
          direction: 'OUTBOUND',
          createdAt: { gte: new Date(now.getTime() - 60_000) },
        },
      });
      if (acceptedInWindow >= 30) {
        throw new HttpException(
          'Instagram reply rate limit exceeded',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      const messageId = randomUUID();
      const message = await transaction.message.create({
        data: {
          id: messageId,
          tenantId,
          conversationId,
          rawEventId: null,
          channel: 'INSTAGRAM',
          externalMessageId: `local:${messageId}`,
          direction: 'OUTBOUND',
          senderId: connection.externalAccountId,
          text,
          sourceTimestamp: now,
          clientIdempotencyKey: input.idempotencyKey,
          sentByUserId: actorUserId,
          deliveryStatus: 'PENDING',
          nextDeliveryAttemptAt: now,
        },
        include: { attachments: { orderBy: { createdAt: 'asc' } } },
      });
      await transaction.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: now },
      });
      return { message, created: true, connectionActive: true };
    });

    if (result.created) await this.enqueue(tenantId, result.message.id);
    return mapMessage(result.message, result.connectionActive);
  }

  async retry(
    tenantId: string,
    _actorUserId: string,
    conversationId: string,
    messageId: string,
  ): Promise<ConversationMessage> {
    const now = new Date();
    const message = await this.prisma.$transaction(async (transaction) => {
      const conversation = await transaction.conversation.findFirst({
        where: { id: conversationId, tenantId, channel: 'INSTAGRAM' },
      });
      if (!conversation) throw new NotFoundException('Conversation not found');

      const connection = await transaction.instagramConnection.findUnique({ where: { tenantId } });
      if (!isDeliveryConnectionActive(connection, now)) {
        throw new BadRequestException('Instagram connection is not ready for replies');
      }

      const existing = await transaction.message.findFirst({
        where: { id: messageId, tenantId, conversationId, direction: 'OUTBOUND' },
      });
      if (
        !existing ||
        existing.deliveryStatus !== 'FAILED' ||
        existing.deliveryErrorCode !== 'INSTAGRAM_RATE_LIMITED'
      ) {
        throw new BadRequestException('Message cannot be safely retried');
      }

      return transaction.message.update({
        where: { id: messageId },
        data: {
          deliveryStatus: 'PENDING',
          deliveryErrorCode: null,
          deliveryLeaseId: null,
          deliveryLeaseExpiresAt: null,
          nextDeliveryAttemptAt: now,
        },
        include: { attachments: { orderBy: { createdAt: 'asc' } } },
      });
    });

    await this.enqueue(tenantId, message.id);
    return mapMessage(message, true);
  }

  private async enqueue(tenantId: string, messageId: string): Promise<void> {
    try {
      await this.queue.add(
        'instagram.message.send',
        { tenantId, messageId },
        { jobId: messageId, attempts: 1, removeOnComplete: true, removeOnFail: true },
      );
    } catch {
      this.logger.warn({ event: 'instagram_reply_queue_wakeup_failed', tenantId, messageId });
    }
  }
}

function replyCapability(connection: DeliveryConnection | null, now: Date): ConversationDetailResponse['replyCapability'] {
  if (isDeliveryConnectionActive(connection, now)) return { enabled: true, reason: null };
  return {
    enabled: false,
    reason: connection ? 'RECONNECT_REQUIRED' : 'NOT_CONNECTED',
  };
}

function isDeliveryConnectionActive(connection: DeliveryConnection | null, now: Date): connection is DeliveryConnection {
  return connection?.status === 'ACTIVE' &&
    Boolean(connection.encryptedAccessToken) &&
    connection.tokenExpiresAt instanceof Date &&
    connection.tokenExpiresAt.getTime() > now.getTime();
}

function mapMessage(message: {
  id: string;
  direction: string;
  senderId: string;
  text: string | null;
  sourceTimestamp: Date;
  deliveryStatus: 'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'UNKNOWN' | null;
  deliveryAttempts: number;
  deliveryErrorCode: string | null;
  attachments: Array<{ id: string; copyStatus: string }>;
}, connectionActive: boolean): ConversationMessage {
  const isOutbound = message.direction === 'OUTBOUND';
  const retryAllowed = connectionActive &&
    message.deliveryStatus === 'FAILED' &&
    message.deliveryErrorCode === 'INSTAGRAM_RATE_LIMITED';
  return {
    id: message.id,
    direction: isOutbound ? 'OUTBOUND' : 'INBOUND',
    senderId: message.senderId,
    text: message.text,
    sourceTimestamp: message.sourceTimestamp.toISOString(),
    attachments: message.attachments.map((attachment) => ({
      id: attachment.id,
      type: 'IMAGE',
      mediaUrl: `/api/media/${attachment.id}`,
      copyStatus: attachment.copyStatus,
    })),
    delivery: isOutbound && message.deliveryStatus
      ? {
          status: message.deliveryStatus,
          attempts: message.deliveryAttempts,
          errorCode: isDeliveryErrorCode(message.deliveryErrorCode)
            ? message.deliveryErrorCode
            : null,
          retryAllowed,
        }
      : null,
  };
}

function isDeliveryErrorCode(value: string | null): value is NonNullable<ConversationMessage['delivery']>['errorCode'] {
  return value === 'INSTAGRAM_RECONNECT_REQUIRED' ||
    value === 'INSTAGRAM_RATE_LIMITED' ||
    value === 'INSTAGRAM_SEND_FAILED' ||
    value === 'INSTAGRAM_DELIVERY_UNKNOWN';
}

function participantName(
  profile: { displayName: string | null; username: string | null } | null,
  legacyDisplayName: string | null,
): string | null {
  if (!profile) return legacyDisplayName;
  return profile.displayName ?? (profile.username ? null : legacyDisplayName);
}

function profileAvatarUrl(profile: {
  id: string;
  avatarStorageKey: string | null;
  avatarChecksum: string | null;
  refreshVersion: number;
} | null): string | null {
  if (!profile?.avatarStorageKey) return null;
  const version = encodeURIComponent(profile.avatarChecksum ?? `r${profile.refreshVersion}`);
  return `/api/media/instagram-profiles/${profile.id}/avatar?v=${version}`;
}

function encodeCursor(cursor: ConversationCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(value: string): ConversationCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('lastMessageAt' in parsed) ||
      !('id' in parsed) ||
      typeof parsed.lastMessageAt !== 'string' ||
      Number.isNaN(Date.parse(parsed.lastMessageAt)) ||
      typeof parsed.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(parsed.id)
    ) {
      throw new Error('invalid cursor');
    }
    return { lastMessageAt: parsed.lastMessageAt, id: parsed.id };
  } catch {
    throw new BadRequestException('Malformed conversation cursor');
  }
}
