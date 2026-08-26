export type MessageDirection = 'INBOUND' | 'OUTBOUND';
export type AttachmentType = 'IMAGE';

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
  if (!isRecord(payload) || !Array.isArray(payload.entry)) {
    return [];
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
    if (
      !isRecord(attachment) ||
      attachment.type !== 'image' ||
      !isRecord(attachment.payload) ||
      typeof attachment.payload.url !== 'string'
    ) {
      return [];
    }

    return [{ type: 'IMAGE' as const, sourceUrl: attachment.payload.url }];
  });
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
