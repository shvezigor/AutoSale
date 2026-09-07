import {
  conversationDetailResponseSchema,
  conversationListResponseSchema,
  conversationMessageSchema,
  conversationOrderStartResponseSchema,
  conversationOrderStateSchema,
  type ConversationDetailResponse,
  type ConversationListResponse,
  type ConversationMessage,
  type ConversationOrderStartResponse,
  type ConversationOrderState,
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

export async function refreshConversationList(): Promise<ConversationListResponse> {
  return parseResponse(
    await fetch('/api/conversations?limit=50', { cache: 'no-store' }),
    conversationListResponseSchema.parse,
  );
}

export async function refreshConversationOrder(id: string): Promise<ConversationOrderState> {
  return parseResponse(
    await fetch(`/api/conversations/${encodeURIComponent(id)}/order`, { cache: 'no-store' }),
    conversationOrderStateSchema.parse,
  );
}

export async function createConversationOrder(id: string): Promise<ConversationOrderStartResponse> {
  return parseResponse(
    await mutatingFetch(`/api/conversations/${encodeURIComponent(id)}/order`, { method: 'POST' }),
    conversationOrderStartResponseSchema.parse,
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
