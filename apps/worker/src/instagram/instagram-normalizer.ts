export type MessageDirection = 'INBOUND' | 'OUTBOUND';
export type AttachmentType = 'IMAGE' | 'LINK' | 'UNSUPPORTED';

export interface NormalizedInstagramAttachment {
  type: AttachmentType;
  sourceUrl: string;
}

export interface NormalizedInstagramMessage {
  externalMessageId: string;
  externalConversationId: string;
  senderId: string;
  direction: MessageDirection;
  text: string | null;
  sourceTimestamp: Date;
  attachments: NormalizedInstagramAttachment[];
}

export class MalformedSupportedEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedSupportedEventError';
  }
}

export function normalizeInstagramEvent(payload: unknown): NormalizedInstagramMessage[] {
  if (!isRecord(payload) || payload.object !== 'instagram' || !Array.isArray(payload.entry)) {
    throw new MalformedSupportedEventError('Expected a persisted Instagram webhook payload');
  }

  const normalized: NormalizedInstagramMessage[] = [];

  for (const entry of payload.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.messaging)) continue;

    for (const event of entry.messaging) {
      if (!isRecord(event) || !isRecord(event.message)) continue;

      const message = event.message;
      const mid = requiredString(message.mid, 'message.mid');
      const senderId = requiredNestedId(event.sender, 'sender.id');
      const recipientId = requiredNestedId(event.recipient, 'recipient.id');
      const direction: MessageDirection = message.is_echo === true ? 'OUTBOUND' : 'INBOUND';
      const externalConversationId = direction === 'INBOUND' ? senderId : recipientId;
      const timestamp = typeof event.timestamp === 'number' ? event.timestamp : undefined;
      if (!timestamp || !Number.isFinite(timestamp)) {
        throw new MalformedSupportedEventError('Supported message requires timestamp');
      }

      normalized.push({
        externalMessageId: mid,
        externalConversationId,
        senderId,
        direction,
        text: typeof message.text === 'string' ? message.text : null,
        sourceTimestamp: new Date(timestamp),
        attachments: normalizeAttachments(message.attachments),
      });
    }
  }

  return normalized;
}

function normalizeAttachments(value: unknown): NormalizedInstagramAttachment[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((attachment) => {
    if (!isRecord(attachment)) return [];
    const providerType = typeof attachment.type === 'string' ? attachment.type : 'unknown';
    const payload = isRecord(attachment.payload) ? attachment.payload : {};
    const rawUrl = typeof payload.url === 'string'
      ? payload.url
      : typeof payload.story_media_url === 'string'
        ? payload.story_media_url
        : null;

    if (providerType === 'image' || providerType === 'ig_post' || providerType === 'story_mention') {
      return rawUrl && isSafeImageSource(rawUrl)
        ? [{ type: 'IMAGE' as const, sourceUrl: rawUrl }]
        : [unsupportedAttachment(providerType)];
    }

    if (rawUrl && isSafeWebUrl(rawUrl)) {
      return [{ type: 'LINK' as const, sourceUrl: rawUrl }];
    }

    return [unsupportedAttachment(providerType)];
  });
}

function unsupportedAttachment(providerType: string): NormalizedInstagramAttachment {
  const safeType = providerType.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40) || 'unknown';
  return { type: 'UNSUPPORTED', sourceUrl: `instagram:${safeType}` };
}

function isSafeImageSource(value: string): boolean {
  return isSafeWebUrl(value) || /^data:image\/(?:jpeg|png|webp);base64,/i.test(value);
}

function isSafeWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function requiredNestedId(value: unknown, field: string): string {
  if (!isRecord(value)) {
    throw new MalformedSupportedEventError(`Supported message requires ${field}`);
  }
  return requiredString(value.id, field);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new MalformedSupportedEventError(`Supported message requires ${field}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
