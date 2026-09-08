export type TelegramBotErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'INVALID_CHAT'
  | 'RATE_LIMITED'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'PROVIDER_ERROR'
  | 'INVALID_RESPONSE';

export interface TelegramBotClientConfig {
  token: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface TelegramBotIdentity {
  id: string;
  username: string;
}

export interface TelegramSendTextInput {
  chatId: string;
  text: string;
  businessConnectionId?: string;
}

export interface TelegramSendTextResult {
  messageId: string;
  chatId: string;
}

export class TelegramBotError extends Error {
  constructor(
    readonly code: TelegramBotErrorCode,
    readonly status: number | null,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(`Telegram Bot API request failed (${code})`);
    this.name = 'TelegramBotError';
  }
}

export class TelegramBotClient {
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;

  constructor(config: TelegramBotClientConfig) {
    this.fetchFn = config.fetch ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.baseUrl = `https://api.telegram.org/bot${config.token}/`;
  }

  async getMe(): Promise<TelegramBotIdentity> {
    const payload = await this.request('getMe', {});
    const result = resultRecord(payload);
    const id = telegramInteger(result?.id);
    const username = typeof result?.username === 'string' && /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(result.username)
      ? result.username
      : null;

    if (!id || !username || result?.is_bot !== true) {
      throw new TelegramBotError('INVALID_RESPONSE', 200);
    }
    return { id, username };
  }

  async sendText(input: TelegramSendTextInput): Promise<TelegramSendTextResult> {
    if (
      !/^-?\d{1,20}$/.test(input.chatId)
      || input.text.trim().length === 0
      || input.text.length > 4_096
      || (input.businessConnectionId !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(input.businessConnectionId))
    ) {
      throw new Error('Invalid Telegram message input');
    }

    const body: Record<string, string> = { chat_id: input.chatId, text: input.text };
    if (input.businessConnectionId) body.business_connection_id = input.businessConnectionId;
    const payload = await this.request('sendMessage', body);
    const result = resultRecord(payload);
    const messageId = telegramInteger(result?.message_id);
    const chat = isRecord(result?.chat) ? result.chat : null;
    const chatId = telegramInteger(chat?.id);

    if (!messageId || !chatId) throw new TelegramBotError('INVALID_RESPONSE', 200);
    return { messageId, chatId };
  }

  private async request(method: 'getMe' | 'sendMessage', body: Record<string, string>): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new TelegramBotError(error instanceof DOMException && error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', null);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new TelegramBotError('INVALID_RESPONSE', response.status);
    }

    if (response.ok && isRecord(payload) && payload.ok === true) return payload;
    throw providerError(response.status, payload);
  }
}

function providerError(status: number, payload: unknown): TelegramBotError {
  const record = isRecord(payload) ? payload : null;
  const description = typeof record?.description === 'string' ? record.description.toLowerCase() : '';
  const parameters = isRecord(record?.parameters) ? record.parameters : null;
  const retryAfter = typeof parameters?.retry_after === 'number' && Number.isInteger(parameters.retry_after) && parameters.retry_after >= 0
    ? parameters.retry_after
    : null;

  if (status === 401) return new TelegramBotError('UNAUTHORIZED', status);
  if (status === 403) return new TelegramBotError('FORBIDDEN', status);
  if (status === 429) return new TelegramBotError('RATE_LIMITED', status, retryAfter);
  if (status === 400 && description.includes('chat not found')) return new TelegramBotError('INVALID_CHAT', status);
  return new TelegramBotError('PROVIDER_ERROR', status);
}

function resultRecord(payload: unknown): Record<string, unknown> | null {
  return isRecord(payload) && isRecord(payload.result) ? payload.result : null;
}

function telegramInteger(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (typeof value === 'string' && /^-?\d{1,20}$/.test(value)) return value;
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
