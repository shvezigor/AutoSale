import { randomUUID } from 'node:crypto';

import type {
  ConversationDetailResponse,
  ConversationListResponse,
  ConversationMessage,
  ConversationOrderStartResponse,
  ConversationOrderState,
  ConversationQuery,
  OutboundMessageInput,
  SocialChannel,
} from '@autosale/contracts/conversations';
import { replyDraftSourceSchema } from '@autosale/contracts/reply-drafts';
import {
  assertTenantAcceptingMutations,
  PlatformChannelDisabledError,
  type PlatformChannelGate,
  type PrismaClient,
  withTenantTransaction,
} from '@autosale/database';
import { metaInstagramReplyMode } from '@autosale/integrations';
import { toReplyDraftSummary } from './reply-drafts.service.js';
import {
  BadRequestException,
  ConflictException,
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
    name: 'instagram.order.create',
    data: { tenantId: string; triggerMessageId: string },
    options: { jobId: string; attempts: 1; removeOnComplete: true; removeOnFail: true },
  ): Promise<unknown>;
  add(
    name: 'instagram.message.send',
    data: { tenantId: string; messageId: string },
    options: { jobId: string; attempts: 1; removeOnComplete: true; removeOnFail: true },
  ): Promise<unknown>;
  add(
    name: 'tiktok.message.send',
    data: { tenantId: string; messageId: string },
    options: { jobId: string; attempts: 1; removeOnComplete: true; removeOnFail: true },
  ): Promise<unknown>;
}

const TIKTOK_REPLY_WINDOW_MS = 48 * 60 * 60_000;

interface DeliveryConnection {
  status: string;
  encryptedAccessToken: string | null;
  tokenExpiresAt: Date | null;
}

interface TikTokDeliveryConnection {
  status: string;
  capabilities: unknown;
  encryptedAccessToken: string | null;
  encryptedRefreshToken: string | null;
  credentialGenerationId: string | null;
  refreshTokenExpiresAt: Date | null;
  externalAccountId: string;
}

export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly queue: InstagramMessageQueue,
    private readonly channelGate: PlatformChannelGate,
  ) {}

  async list(tenantId: string, query: ConversationQuery): Promise<ConversationListResponse> {
    const limit = Math.min(query.limit, 50);
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const rows = await withTenantTransaction(this.prisma, tenantId, (transaction) => transaction.conversation.findMany({
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
          select: {
            text: true,
            attachments: { take: 1, orderBy: { createdAt: 'asc' }, select: { type: true } },
          },
        },
      },
    }));

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);

    return {
      items: page.map((conversation) => ({
        id: conversation.id,
        channel: socialChannel(conversation.channel),
        participantName: participantName(conversation.profile, conversation.displayName),
        participantUsername: conversation.profile?.username ?? null,
        participantAvatarUrl: profileAvatarUrl(conversation.profile),
        lastMessagePreview: conversation.messages[0]?.text
          ?? attachmentPreview(conversation.messages[0]?.attachments[0]?.type, socialChannel(conversation.channel)),
        lastMessageAt: conversation.lastMessageAt.toISOString(),
      })),
      nextCursor:
        hasMore && last
          ? encodeCursor({ lastMessageAt: last.lastMessageAt.toISOString(), id: last.id })
          : null,
    };
  }

  async detail(tenantId: string, id: string): Promise<ConversationDetailResponse> {
    const [conversation, instagramConnection, tikTokConnection, replyDrafts] = await withTenantTransaction(this.prisma, tenantId, (transaction) => Promise.all([
      transaction.conversation.findFirst({
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
      transaction.instagramConnection.findUnique({ where: { tenantId } }),
      transaction.tikTokConnection.findUnique({ where: { tenantId } }),
      transaction.aiReplyDraft.findMany({
        where: { tenantId, conversationId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 5,
      }),
    ]));

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const channel = socialChannel(conversation.channel);
    const now = new Date();
    const lastInboundAt = latestInboundAt(conversation.messages);
    const connectionActive = channel === 'INSTAGRAM'
      ? isDeliveryConnectionActive(instagramConnection, now)
      : channel === 'TIKTOK' && tikTokReplyCapability(tikTokConnection, now, lastInboundAt).enabled;
    return {
      id: conversation.id,
      channel,
      participantName: participantName(conversation.profile, conversation.displayName),
      participantUsername: conversation.profile?.username ?? null,
      participantAvatarUrl: profileAvatarUrl(conversation.profile),
      replyCapability: channel === 'INSTAGRAM'
        ? replyCapability(instagramConnection, now, lastInboundAt)
        : channel === 'TIKTOK'
          ? tikTokReplyCapability(tikTokConnection, now, lastInboundAt)
          : { enabled: false, reason: 'CHANNEL_READ_ONLY' },
      messages: conversation.messages.map((message) => mapMessage(
        message,
        connectionActive,
      )),
      replyDrafts: replyDrafts.map(toReplyDraftSummary),
    };
  }

  async orderState(tenantId: string, conversationId: string): Promise<ConversationOrderState> {
    const conversation = await withTenantTransaction(this.prisma, tenantId, (transaction) => transaction.conversation.findFirst({
      where: { id: conversationId, tenantId },
      include: {
        messages: {
          orderBy: [{ sourceTimestamp: 'desc' }, { id: 'desc' }],
          take: 1,
          select: { id: true },
        },
      },
    }));
    if (!conversation) throw new NotFoundException('Conversation not found');
    const latestMessage = conversation.messages[0];
    if (!latestMessage) return { order: null };
    const order = await withTenantTransaction(this.prisma, tenantId, (transaction) => transaction.order.findFirst({
      where: { triggerMessageId: latestMessage.id, tenantId, conversationId },
      select: { id: true, status: true },
    }));
    return { order: order ? {
      id: order.id,
      status: order.status as NonNullable<ConversationOrderState['order']>['status'],
    } : null };
  }

  async createOrder(tenantId: string, conversationId: string): Promise<ConversationOrderStartResponse> {
    const conversation = await withTenantTransaction(this.prisma, tenantId, (transaction) => transaction.conversation.findFirst({
      where: { id: conversationId, tenantId },
      include: {
        messages: {
          orderBy: [{ sourceTimestamp: 'desc' }, { id: 'desc' }],
          take: 1,
          select: { id: true },
        },
      },
    }));
    if (!conversation) throw new NotFoundException('Conversation not found');
    const latestMessage = conversation.messages[0];
    if (!latestMessage) throw new BadRequestException('Conversation has no messages');
    const existing = await withTenantTransaction(this.prisma, tenantId, (transaction) => transaction.order.findFirst({
      where: { triggerMessageId: latestMessage.id, tenantId, conversationId },
      select: { id: true },
    }));
    if (existing) return { orderId: existing.id, queued: false };

    await withTenantTransaction(this.prisma, tenantId, (transaction) =>
      assertTenantAcceptingMutations(transaction, tenantId, 'ORDER_RECOGNITION'));

    await this.queue.add(
      'instagram.order.create',
      { tenantId, triggerMessageId: latestMessage.id },
      {
        jobId: `manual-order-${latestMessage.id}`,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    return { orderId: null, queued: true };
  }

  async send(
    tenantId: string,
    actorUserId: string,
    conversationId: string,
    input: OutboundMessageInput,
  ): Promise<ConversationMessage> {
    const now = new Date();
    const text = input.text.trim();
    const result = await withTenantTransaction(this.prisma, tenantId, async (transaction) => {
      await assertTenantAcceptingMutations(transaction, tenantId, 'CONVERSATION_REPLY');
      const conversation = await transaction.conversation.findFirst({
        where: { id: conversationId, tenantId, channel: { in: ['INSTAGRAM', 'TIKTOK'] } },
        include: {
          messages: {
            where: { direction: 'INBOUND' },
            orderBy: [{ sourceTimestamp: 'desc' }, { id: 'desc' }],
            take: 1,
            select: { id: true, sourceTimestamp: true },
          },
        },
      });
      if (!conversation) throw new NotFoundException('Conversation not found');
      const anchorMessageId = conversation.messages[0]?.id;
      if (input.draftId && !anchorMessageId) throw new ConflictException('AI draft has no current inbound message');
      const channel = replyChannel(conversation.channel);
      await this.assertChannelEnabled(channel);
      let senderId: string;
      let credentialGenerationId: string | null = null;
      if (channel === 'INSTAGRAM') {
        const connection = await transaction.instagramConnection.findUnique({ where: { tenantId } });
        if (!isDeliveryConnectionActive(connection, now)) {
          throw new BadRequestException('Instagram connection is not ready for replies');
        }
        const replyMode = metaInstagramReplyMode(conversation.messages[0]?.sourceTimestamp ?? null, now);
        if (replyMode === 'EXPIRED') {
          throw new BadRequestException('Instagram reply window expired');
        }
        if (input.draftId && replyMode !== 'STANDARD') {
          throw new ConflictException('AI draft requires the standard Instagram reply window');
        }
        senderId = connection.externalAccountId;
      } else {
        const connection = await transaction.tikTokConnection.findUnique({ where: { tenantId } });
        const capability = tikTokReplyCapability(
          connection,
          now,
          conversation.messages[0]?.sourceTimestamp ?? null,
        );
        if (!capability.enabled || !connection?.credentialGenerationId) {
          throw new BadRequestException('TikTok connection is not ready for replies');
        }
        senderId = connection.externalAccountId;
        credentialGenerationId = connection.credentialGenerationId;
      }

      const existing = await transaction.message.findFirst({
        where: { tenantId, clientIdempotencyKey: input.idempotencyKey },
        include: { attachments: { orderBy: { createdAt: 'asc' } } },
      });
      if (existing) {
        if (existing.conversationId !== conversationId || existing.text !== text) {
          throw new BadRequestException('Idempotency key was already used');
        }
        const linkedDraft = await transaction.aiReplyDraft.findFirst({
          where: { tenantId, outboundMessageId: existing.id }, select: { id: true },
        });
        if ((linkedDraft?.id ?? null) !== (input.draftId ?? null)) {
          throw new BadRequestException('Idempotency key was already used for another reply');
        }
        return { message: existing, created: false, connectionActive: true };
      }

      if (input.draftId) {
        const draft = await transaction.aiReplyDraft.findFirst({
          where: { id: input.draftId, tenantId, conversationId },
        });
        if (!draft || draft.status !== 'READY' || draft.anchorMessageId !== anchorMessageId) {
          throw new ConflictException('AI draft is no longer ready for this conversation');
        }
        const sources = replyDraftSourceSchema.array().max(8).safeParse(draft.sourceSnapshot);
        if (!sources.success) throw new ConflictException('AI draft sources are unavailable');
        if (sources.data.length) {
          const products = await transaction.product.findMany({
            where: { tenantId, id: { in: sources.data.map((source) => source.productId) } },
            select: { id: true, active: true, updatedAt: true },
          });
          const byId = new Map(products.map((product) => [product.id, product]));
          if (sources.data.some((source) => {
            const product = byId.get(source.productId);
            return !product?.active || product.updatedAt.toISOString() !== source.updatedAt;
          })) throw new ConflictException('AI draft catalogue sources have changed');
        }
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
          'Conversation reply rate limit exceeded',
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
          channel,
          externalMessageId: `local:${messageId}`,
          direction: 'OUTBOUND',
          senderId,
          text,
          sourceTimestamp: now,
          clientIdempotencyKey: input.idempotencyKey,
          sentByUserId: actorUserId,
          deliveryStatus: 'PENDING',
          deliveryCredentialGenerationId: credentialGenerationId,
          nextDeliveryAttemptAt: now,
        },
        include: { attachments: { orderBy: { createdAt: 'asc' } } },
      });
      if (input.draftId) {
        const used = await transaction.aiReplyDraft.updateMany({
          where: {
            id: input.draftId, tenantId, conversationId, status: 'READY',
            anchorMessageId: anchorMessageId!,
          },
          data: { status: 'USED', finalText: text, outboundMessageId: message.id, usedAt: now },
        });
        if (used.count !== 1) throw new ConflictException('AI draft was already used or changed');
      }
      await transaction.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: now },
      });
      return { message, created: true, connectionActive: true };
    });

    if (result.created) await this.enqueue(replyChannel(result.message.channel), tenantId, result.message.id);
    return mapMessage(result.message, result.connectionActive);
  }

  async retry(
    tenantId: string,
    _actorUserId: string,
    conversationId: string,
    messageId: string,
  ): Promise<ConversationMessage> {
    const now = new Date();
    const message = await withTenantTransaction(this.prisma, tenantId, async (transaction) => {
      await assertTenantAcceptingMutations(transaction, tenantId, 'CONVERSATION_REPLY');
      const conversation = await transaction.conversation.findFirst({
        where: { id: conversationId, tenantId, channel: { in: ['INSTAGRAM', 'TIKTOK'] } },
        include: {
          messages: {
            where: { direction: 'INBOUND' },
            orderBy: [{ sourceTimestamp: 'desc' }, { id: 'desc' }],
            take: 1,
            select: { sourceTimestamp: true },
          },
        },
      });
      if (!conversation) throw new NotFoundException('Conversation not found');
      const channel = replyChannel(conversation.channel);
      await this.assertChannelEnabled(channel);
      let credentialGenerationId: string | null = null;
      if (channel === 'INSTAGRAM') {
        const connection = await transaction.instagramConnection.findUnique({ where: { tenantId } });
        if (!isDeliveryConnectionActive(connection, now)) {
          throw new BadRequestException('Instagram connection is not ready for replies');
        }
      } else {
        const connection = await transaction.tikTokConnection.findUnique({ where: { tenantId } });
        if (!tikTokReplyCapability(
          connection,
          now,
          conversation.messages[0]?.sourceTimestamp ?? null,
        ).enabled || !connection?.credentialGenerationId) {
          throw new BadRequestException('TikTok connection is not ready for replies');
        }
        credentialGenerationId = connection.credentialGenerationId;
      }

      const existing = await transaction.message.findFirst({
        where: { id: messageId, tenantId, conversationId, channel, direction: 'OUTBOUND' },
      });
      if (
        !existing ||
        existing.deliveryStatus !== 'FAILED' ||
        existing.deliveryErrorCode !== (channel === 'INSTAGRAM' ? 'INSTAGRAM_RATE_LIMITED' : 'TIKTOK_RATE_LIMITED') ||
        (channel === 'TIKTOK' && existing.deliveryCredentialGenerationId !== credentialGenerationId)
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

    await this.enqueue(replyChannel(message.channel), tenantId, message.id);
    return mapMessage(message, true);
  }

  private async enqueue(channel: 'INSTAGRAM' | 'TIKTOK', tenantId: string, messageId: string): Promise<void> {
    try {
      const options = {
        jobId: messageId,
        attempts: 1 as const,
        removeOnComplete: true as const,
        removeOnFail: true as const,
      };
      if (channel === 'INSTAGRAM') {
        await this.queue.add('instagram.message.send', { tenantId, messageId }, options);
      } else {
        await this.queue.add('tiktok.message.send', { tenantId, messageId }, options);
      }
    } catch {
      this.logger.warn({ event: 'social_reply_queue_wakeup_failed', channel, tenantId, messageId });
    }
  }

  private async assertChannelEnabled(channel: 'INSTAGRAM' | 'TIKTOK'): Promise<void> {
    if (channel === 'INSTAGRAM') return;
    try {
      await this.channelGate.assertEnabled('TIKTOK_BUSINESS_MESSAGING');
    } catch (error) {
      if (error instanceof PlatformChannelDisabledError) {
        throw new BadRequestException('TIKTOK_CHANNEL_DISABLED');
      }
      throw error;
    }
  }
}

function replyCapability(
  connection: DeliveryConnection | null,
  now: Date,
  lastInboundAt: Date | null,
): ConversationDetailResponse['replyCapability'] {
  if (isDeliveryConnectionActive(connection, now)) {
    return metaInstagramReplyMode(lastInboundAt, now) === 'EXPIRED'
      ? { enabled: false, reason: 'REPLY_WINDOW_EXPIRED' }
      : { enabled: true, reason: null };
  }
  return {
    enabled: false,
    reason: connection ? 'RECONNECT_REQUIRED' : 'NOT_CONNECTED',
  };
}

function tikTokReplyCapability(
  connection: TikTokDeliveryConnection | null,
  now: Date,
  lastInboundAt: Date | null,
): ConversationDetailResponse['replyCapability'] {
  if (!connection) return { enabled: false, reason: 'NOT_CONNECTED' };
  if (connection.status === 'INBOUND_ONLY' || !tikTokSendTextCapability(connection.capabilities)) {
    return { enabled: false, reason: 'TIKTOK_CAPABILITY_UNAVAILABLE' };
  }
  if (
    connection.status !== 'ACTIVE' ||
    !connection.encryptedAccessToken ||
    !connection.encryptedRefreshToken ||
    !connection.credentialGenerationId ||
    !(connection.refreshTokenExpiresAt instanceof Date) ||
    connection.refreshTokenExpiresAt.getTime() <= now.getTime()
  ) {
    return { enabled: false, reason: 'RECONNECT_REQUIRED' };
  }
  if (!(lastInboundAt instanceof Date) || now.getTime() - lastInboundAt.getTime() > TIKTOK_REPLY_WINDOW_MS) {
    return { enabled: false, reason: 'TIKTOK_REPLY_NOT_PERMITTED' };
  }
  return { enabled: true, reason: null };
}

function tikTokSendTextCapability(value: unknown): boolean {
  return typeof value === 'object' && value !== null &&
    'sendText' in value && value.sendText === true;
}

function latestInboundAt(messages: Array<{ direction: string; sourceTimestamp: Date }>): Date | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.direction === 'INBOUND') return message.sourceTimestamp;
  }
  return null;
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
  attachments: Array<{ id: string; type: string; originalUrl: string; copyStatus: string }>;
}, connectionActive: boolean): ConversationMessage {
  const isOutbound = message.direction === 'OUTBOUND';
  const retryAllowed = connectionActive &&
    message.deliveryStatus === 'FAILED' &&
    (message.deliveryErrorCode === 'INSTAGRAM_RATE_LIMITED' ||
      message.deliveryErrorCode === 'TIKTOK_RATE_LIMITED');
  return {
    id: message.id,
    direction: isOutbound ? 'OUTBOUND' : 'INBOUND',
    senderId: message.senderId,
    text: message.text,
    sourceTimestamp: message.sourceTimestamp.toISOString(),
    attachments: message.attachments.map(mapAttachment),
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

function mapAttachment(attachment: {
  id: string;
  type: string;
  originalUrl: string;
  copyStatus: string;
}): ConversationMessage['attachments'][number] {
  if (attachment.type === 'IMAGE' || attachment.type === 'VIDEO') {
    return {
      id: attachment.id,
      type: attachment.type,
      mediaUrl: `/api/media/${attachment.id}`,
      copyStatus: attachment.copyStatus,
    };
  }
  if (attachment.type === 'LINK' && isSafeExternalUrl(attachment.originalUrl)) {
    return {
      id: attachment.id,
      type: 'LINK',
      mediaUrl: attachment.originalUrl,
      copyStatus: attachment.copyStatus,
    };
  }
  return {
    id: attachment.id,
    type: 'UNSUPPORTED',
    mediaUrl: null,
    copyStatus: attachment.copyStatus,
  };
}

function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function attachmentPreview(type: string | undefined, channel: SocialChannel): string | null {
  const provider = channelLabel(channel);
  if (type === 'IMAGE') return `📷 ${provider}`;
  if (type === 'VIDEO') return `🎬 ${provider}`;
  if (type === 'LINK') return `🔗 ${provider}`;
  if (type) return `📎 ${provider}`;
  return null;
}

function socialChannel(value: string): SocialChannel {
  switch (value) {
    case 'INSTAGRAM':
    case 'FACEBOOK':
    case 'TIKTOK':
      return value;
    default:
      throw new Error('Unsupported social channel');
  }
}

function channelLabel(channel: SocialChannel): 'Instagram' | 'Facebook' | 'TikTok' {
  switch (channel) {
    case 'INSTAGRAM': return 'Instagram';
    case 'FACEBOOK': return 'Facebook';
    case 'TIKTOK': return 'TikTok';
  }
}

function isDeliveryErrorCode(value: string | null): value is NonNullable<ConversationMessage['delivery']>['errorCode'] {
  return value === 'INSTAGRAM_RECONNECT_REQUIRED' ||
    value === 'INSTAGRAM_RATE_LIMITED' ||
    value === 'INSTAGRAM_SEND_FAILED' ||
    value === 'INSTAGRAM_DELIVERY_UNKNOWN' ||
    value === 'INSTAGRAM_REPLY_WINDOW_EXPIRED' ||
    value === 'INSTAGRAM_HUMAN_AGENT_UNAVAILABLE' ||
    value === 'TIKTOK_RECONNECT_REQUIRED' ||
    value === 'TIKTOK_RATE_LIMITED' ||
    value === 'TIKTOK_SEND_FAILED' ||
    value === 'TIKTOK_DELIVERY_UNKNOWN' ||
    value === 'TIKTOK_REPLY_NOT_PERMITTED';
}

function replyChannel(value: string): 'INSTAGRAM' | 'TIKTOK' {
  switch (value) {
    case 'INSTAGRAM':
    case 'TIKTOK':
      return value;
    default:
      throw new Error('Unsupported reply channel');
  }
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
