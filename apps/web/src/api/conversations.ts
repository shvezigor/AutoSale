import {
  conversationDetailResponseSchema,
  conversationListResponseSchema,
  type ConversationDetailResponse,
  type ConversationListResponse,
} from '../../../../packages/contracts/src/conversations';
import { authenticatedApiFetch } from '../auth/session';

export class ConversationApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ConversationApiError';
  }
}

export async function getConversations(): Promise<ConversationListResponse> {
  return request('/api/conversations?limit=50', conversationListResponseSchema.parse);
}

export async function getConversation(id: string): Promise<ConversationDetailResponse> {
  return request(
    `/api/conversations/${encodeURIComponent(id)}`,
    conversationDetailResponseSchema.parse,
  );
}

async function request<T>(path: string, parse: (value: unknown) => T): Promise<T> {
  const response = await authenticatedApiFetch(path);
  if (!response.ok) {
    throw new ConversationApiError(`Conversation API returned HTTP ${response.status}`, response.status);
  }

  try {
    return parse(await response.json());
  } catch (error) {
    throw new ConversationApiError('Conversation API returned an invalid response', response.status, {
      cause: error,
    });
  }
}
