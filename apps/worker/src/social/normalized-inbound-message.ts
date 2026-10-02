export type SocialChannel = 'INSTAGRAM' | 'FACEBOOK';
export type MessageDirection = 'INBOUND' | 'OUTBOUND';
export type AttachmentType = 'IMAGE' | 'VIDEO' | 'LINK' | 'UNSUPPORTED';

export interface NormalizedInboundAttachment {
  type: AttachmentType;
  sourceUrl: string;
}

export interface NormalizedInboundMessage {
  channel: SocialChannel;
  externalMessageId: string;
  externalConversationId: string;
  participantId: string;
  senderId: string;
  direction: MessageDirection;
  text: string | null;
  sourceTimestamp: Date;
  attachments: NormalizedInboundAttachment[];
}

export class MalformedSupportedEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedSupportedEventError';
  }
}
