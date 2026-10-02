import {
  MalformedSupportedEventError,
  type NormalizedInboundAttachment,
  type NormalizedInboundMessage,
} from '../social/normalized-inbound-message.js';

export function normalizeFacebookEvent(payload: unknown): NormalizedInboundMessage[] {
  if (!isRecord(payload) || payload.object !== 'page' || !Array.isArray(payload.entry)) {
    throw new MalformedSupportedEventError('Expected a persisted Facebook Page webhook payload');
  }

  const normalized: NormalizedInboundMessage[] = [];
  for (const entry of payload.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.messaging)) continue;
    for (const event of entry.messaging) {
      if (!isRecord(event) || !isRecord(event.message)) continue;
      if (event.message.is_echo === true) continue;

      const senderId = requiredNestedId(event.sender, 'sender.id');
      requiredNestedId(event.recipient, 'recipient.id');
      const timestamp = typeof event.timestamp === 'number' ? event.timestamp : undefined;
      if (!timestamp || !Number.isFinite(timestamp)) {
        throw new MalformedSupportedEventError('Supported message requires timestamp');
      }

      normalized.push({
        channel: 'FACEBOOK',
        externalMessageId: requiredString(event.message.mid, 'message.mid'),
        externalConversationId: senderId,
        participantId: senderId,
        senderId,
        direction: 'INBOUND',
        text: typeof event.message.text === 'string' ? event.message.text : null,
        sourceTimestamp: new Date(timestamp),
        attachments: normalizeAttachments(event.message.attachments),
      });
    }
  }
  return normalized;
}

function normalizeAttachments(value: unknown): NormalizedInboundAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((attachment) => {
    if (!isRecord(attachment)) return [];
    const providerType = typeof attachment.type === 'string' ? attachment.type : 'unknown';
    const payload = isRecord(attachment.payload) ? attachment.payload : {};
    const rawUrl = typeof payload.url === 'string' ? payload.url : null;

    if (providerType === 'image') {
      return rawUrl && isSafeMediaSource(rawUrl)
        ? [{ type: 'IMAGE' as const, sourceUrl: rawUrl }]
        : [unsupportedAttachment(providerType)];
    }
    if (providerType === 'video') {
      return rawUrl && isSafeWebUrl(rawUrl)
        ? [{ type: 'VIDEO' as const, sourceUrl: rawUrl }]
        : [unsupportedAttachment(providerType)];
    }
    if ((providerType === 'fallback' || providerType === 'share') && rawUrl && isSafeWebUrl(rawUrl)) {
      return [{ type: 'LINK' as const, sourceUrl: rawUrl }];
    }
    return [unsupportedAttachment(providerType)];
  });
}

function unsupportedAttachment(providerType: string): NormalizedInboundAttachment {
  const safeType = providerType.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40) || 'unknown';
  return { type: 'UNSUPPORTED', sourceUrl: `facebook:${safeType}` };
}

function isSafeMediaSource(value: string): boolean {
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
  if (!isRecord(value)) throw new MalformedSupportedEventError(`Supported message requires ${field}`);
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
