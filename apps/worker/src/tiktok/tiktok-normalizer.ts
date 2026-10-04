import {
  MalformedSupportedEventError,
  type NormalizedInboundAttachment,
  type NormalizedInboundMessage,
} from '../social/normalized-inbound-message.js';

export interface TikTokMediaReference {
  accountId: string;
  conversationId: string;
  messageId: string;
  mediaId: string;
  mediaType: 'IMAGE' | 'VIDEO';
}

const MEDIA_PREFIX = 'tiktok-media:';

export function normalizeTikTokEvent(payload: unknown): NormalizedInboundMessage[] {
  if (!isRecord(payload) || typeof payload.event !== 'string') {
    throw new MalformedSupportedEventError('Expected a persisted TikTok webhook payload');
  }
  if (payload.event === 'im_send_msg') return [];
  if (payload.event !== 'im_receive_msg' && payload.event !== 'im_receive_msg_eu') return [];
  if (typeof payload.user_openid !== 'string' || typeof payload.content !== 'string') {
    throw new MalformedSupportedEventError('TikTok message requires account and content');
  }

  let content: unknown;
  try {
    content = JSON.parse(payload.content);
  } catch {
    throw new MalformedSupportedEventError('TikTok message content must be valid JSON');
  }
  if (!isRecord(content)) throw new MalformedSupportedEventError('TikTok message content must be an object');

  const messageId = requiredString(content.message_id, 'message_id');
  const conversationId = requiredString(content.conversation_id, 'conversation_id');
  const senderId = participantId(content);
  const timestamp = requiredTimestamp(content.timestamp);
  const type = requiredString(content.type, 'type').toLowerCase();
  const text = isRecord(content.text) && typeof content.text.body === 'string'
    ? content.text.body
    : null;

  return [{
    channel: 'TIKTOK',
    externalMessageId: messageId,
    externalConversationId: conversationId,
    participantId: senderId,
    senderId,
    direction: 'INBOUND',
    text,
    sourceTimestamp: timestamp,
    attachments: normalizeAttachments({
      accountId: payload.user_openid,
      conversationId,
      messageId,
      type,
      content,
    }),
  }];
}

export function decodeTikTokMediaSource(sourceUrl: string): TikTokMediaReference {
  if (!sourceUrl.startsWith(MEDIA_PREFIX)) throw new Error('Invalid TikTok media reference');
  try {
    const decoded: unknown = JSON.parse(Buffer.from(sourceUrl.slice(MEDIA_PREFIX.length), 'base64url').toString('utf8'));
    if (!isRecord(decoded)) throw new Error();
    const mediaType = decoded.mediaType;
    if (mediaType !== 'IMAGE' && mediaType !== 'VIDEO') throw new Error();
    return {
      accountId: requiredString(decoded.accountId, 'accountId'),
      conversationId: requiredString(decoded.conversationId, 'conversationId'),
      messageId: requiredString(decoded.messageId, 'messageId'),
      mediaId: requiredString(decoded.mediaId, 'mediaId'),
      mediaType,
    };
  } catch {
    throw new Error('Invalid TikTok media reference');
  }
}

function normalizeAttachments(input: {
  accountId: string;
  conversationId: string;
  messageId: string;
  type: string;
  content: Record<string, unknown>;
}): NormalizedInboundAttachment[] {
  const base = {
    accountId: input.accountId,
    conversationId: input.conversationId,
    messageId: input.messageId,
  };
  if (input.type === 'image' || input.type === 'video') {
    const media = input.content[input.type];
    if (!isRecord(media)) throw new MalformedSupportedEventError(`TikTok ${input.type} message requires media`);
    const mediaType = input.type === 'image' ? 'IMAGE' : 'VIDEO';
    return [{
      type: mediaType,
      sourceUrl: encodeMediaSource({
        ...base,
        mediaId: requiredString(media.media_id, `${input.type}.media_id`),
        mediaType,
      }),
    }];
  }
  if (input.type === 'share_post') {
    const share = input.content.share_post;
    if (!isRecord(share) || !isSafeWebUrl(share.embed_url)) {
      throw new MalformedSupportedEventError('TikTok shared post requires an HTTPS URL');
    }
    return [{ type: 'LINK', sourceUrl: share.embed_url }];
  }
  if (input.type === 'text') return [];
  return [{ type: 'UNSUPPORTED', sourceUrl: `tiktok:${safeType(input.type)}` }];
}

function encodeMediaSource(reference: TikTokMediaReference): string {
  return `${MEDIA_PREFIX}${Buffer.from(JSON.stringify(reference)).toString('base64url')}`;
}

function participantId(content: Record<string, unknown>): string {
  if (typeof content.unique_identifier === 'string' && content.unique_identifier.length > 0) {
    return content.unique_identifier;
  }
  if (isRecord(content.from_user) && typeof content.from_user.id === 'string' && content.from_user.id.length > 0) {
    return content.from_user.id;
  }
  return requiredString(content.from, 'from');
}

function requiredTimestamp(value: unknown): Date {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new MalformedSupportedEventError('TikTok message requires a timestamp');
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new MalformedSupportedEventError('TikTok timestamp is invalid');
  return date;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new MalformedSupportedEventError(`TikTok message requires ${field}`);
  }
  return value;
}

function isSafeWebUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

function safeType(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40) || 'unknown';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
