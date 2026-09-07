import {
  conversationDetailResponseSchema,
  conversationMessageSchema,
  type ConversationDetailResponse,
  type ConversationMessage,
  type OutboundMessageInput,
} from '../../../../packages/contracts/src/conversations';
import { mutatingFetch } from '../auth/csrf-fetch';

export class ConversationReplyApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ConversationReplyApiError';
  }
}

export async function refreshConversation(id: string): Promise<ConversationDetailResponse> {
  return parseResponse(
    await fetch(`/api/conversations/${encodeURIComponent(id)}`, { cache: 'no-store' }),
    conversationDetailResponseSchema.parse,
  );
}

export async function sendConversationMessage(
  conversationId: string,
  input: OutboundMessageInput,
): Promise<ConversationMessage> {
  return parseResponse(
    await mutatingFetch(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
    conversationMessageSchema.parse,
  );
}

export async function retryConversationMessage(
  conversationId: string,
  messageId: string,
): Promise<ConversationMessage> {
  return parseResponse(
    await mutatingFetch(
      `/api/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/retry`,
      { method: 'POST' },
    ),
    conversationMessageSchema.parse,
  );
}

async function parseResponse<T>(response: Response, parse: (value: unknown) => T): Promise<T> {
  if (!response.ok) throw new ConversationReplyApiError('Не вдалося виконати дію', response.status);
  try {
    return parse(await response.json());
  } catch (error) {
    throw new ConversationReplyApiError('Сервер повернув некоректні дані', response.status, { cause: error });
  }
}
