import type {
  ConversationDetailResponse,
  ConversationListResponse,
  ConversationQuery,
} from '@autosale/contracts/conversations';
import type { PrismaClient } from '@autosale/database';
import { BadRequestException, NotFoundException } from '@nestjs/common';

interface ConversationCursor {
  lastMessageAt: string;
  id: string;
}

export class ConversationsService {
  constructor(private readonly prisma: PrismaClient) {}

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
        participantName: conversation.profile?.displayName ?? conversation.displayName,
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
    const conversation = await this.prisma.conversation.findFirst({
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
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    return {
      id: conversation.id,
      channel: 'INSTAGRAM',
      participantName: conversation.profile?.displayName ?? conversation.displayName,
      participantUsername: conversation.profile?.username ?? null,
      participantAvatarUrl: profileAvatarUrl(conversation.profile),
      messages: conversation.messages.map((message) => ({
        id: message.id,
        direction: message.direction === 'OUTBOUND' ? 'OUTBOUND' : 'INBOUND',
        senderId: message.senderId,
        text: message.text,
        sourceTimestamp: message.sourceTimestamp.toISOString(),
        attachments: message.attachments.map((attachment) => ({
          id: attachment.id,
          type: 'IMAGE',
          mediaUrl: `/api/media/${attachment.id}`,
          copyStatus: attachment.copyStatus,
        })),
      })),
    };
  }
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
