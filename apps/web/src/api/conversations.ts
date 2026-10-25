import {
  conversationDetailResponseSchema,
  conversationStatusCountsSchema,
  type ConversationWorkflowStatus,
  conversationListResponseSchema,
  conversationOrderStateSchema,
  type ConversationDetailResponse,
  type ConversationListResponse,
  type ConversationOrderState,
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

export async function getConversations(input?: { status: ConversationWorkflowStatus }): Promise<ConversationListResponse> {
  const query = new URLSearchParams({ limit: "50" });
  if (input) query.set("status", input.status);
  return request(`/api/conversations?${query.toString()}`, conversationListResponseSchema.parse);
}

export async function getConversation(id: string): Promise<ConversationDetailResponse> {
  return request(
    `/api/conversations/${encodeURIComponent(id)}`,
    conversationDetailResponseSchema.parse,
  );
}

export async function getConversationOrder(id: string): Promise<ConversationOrderState> {
  return request(
    `/api/conversations/${encodeURIComponent(id)}/order`,
    conversationOrderStateSchema.parse,
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

export async function getConversationStatusCounts() {
  return request("/api/conversations/status-counts", conversationStatusCountsSchema.parse);
}
