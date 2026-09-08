import { describe, expect, it, vi } from 'vitest';

import { TelegramBotClient, TelegramBotError } from './telegram-bot.js';

const token = '123456789:token-that-must-never-appear-in-errors';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('TelegramBotClient', () => {
  it('returns the verified bot identity without exposing the token in request data', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response({
      ok: true,
      result: { id: 123456789, is_bot: true, first_name: 'AutoSale', username: 'AutoSaleBot' },
    }));
    const client = new TelegramBotClient({ token, fetch: fetchFn });

    await expect(client.getMe()).resolves.toEqual({ id: '123456789', username: 'AutoSaleBot' });

    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(String(url)).toBe(`https://api.telegram.org/bot${token}/getMe`);
    expect(init).toMatchObject({ method: 'POST' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('sends plain text to a numeric chat and returns string identifiers', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response({
      ok: true,
      result: { message_id: 42, chat: { id: -1001234567890 } },
    }));
    const client = new TelegramBotClient({ token, fetch: fetchFn });

    await expect(client.sendText({ chatId: '-1001234567890', text: 'Нове замовлення' })).resolves.toEqual({
      messageId: '42', chatId: '-1001234567890',
    });

    const [, init] = fetchFn.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({ chat_id: '-1001234567890', text: 'Нове замовлення' });
  });

  it('includes a validated business connection only when requested', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response({
      ok: true,
      result: { message_id: 43, chat: { id: 998877 } },
    }));
    const client = new TelegramBotClient({ token, fetch: fetchFn });

    await client.sendText({ chatId: '998877', text: 'Замовлення', businessConnectionId: 'business-connection_1' });

    expect(JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body))).toEqual({
      chat_id: '998877', text: 'Замовлення', business_connection_id: 'business-connection_1',
    });
  });

  it.each([
    [401, { ok: false, error_code: 401, description: 'bad token secret' }, 'UNAUTHORIZED', null],
    [403, { ok: false, error_code: 403, description: 'bot blocked secret' }, 'FORBIDDEN', null],
    [400, { ok: false, error_code: 400, description: 'Bad Request: chat not found secret' }, 'INVALID_CHAT', null],
    [429, { ok: false, error_code: 429, description: 'retry secret', parameters: { retry_after: 7 } }, 'RATE_LIMITED', 7],
    [503, { ok: false, error_code: 503, description: 'provider secret' }, 'PROVIDER_ERROR', null],
  ] as const)('maps HTTP %s to a bounded safe error', async (status, body, code, retryAfterSeconds) => {
    const client = new TelegramBotClient({ token, fetch: vi.fn<typeof fetch>().mockResolvedValue(response(body, status)) });

    const failure = client.sendText({ chatId: '998877', text: 'Замовлення' });
    await expect(failure).rejects.toEqual(expect.objectContaining({
      name: 'TelegramBotError', code, status, retryAfterSeconds,
    }));
    await expect(failure).rejects.not.toThrow(token);
    await expect(failure).rejects.not.toThrow('secret');
  });

  it.each([
    ['NETWORK', new Error(`network failed ${token}`)],
    ['TIMEOUT', new DOMException(`aborted ${token}`, 'AbortError')],
  ] as const)('sanitizes a %s transport failure', async (code, providerFailure) => {
    const client = new TelegramBotClient({ token, fetch: vi.fn<typeof fetch>().mockRejectedValue(providerFailure) });

    const failure = client.getMe();
    await expect(failure).rejects.toEqual(expect.objectContaining({ name: 'TelegramBotError', code, status: null }));
    await expect(failure).rejects.not.toThrow(token);
  });

  it('rejects malformed success payloads as bounded invalid responses', async () => {
    const client = new TelegramBotClient({
      token,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(response({ ok: true, result: { message_id: 'bad' } })),
    });

    await expect(client.sendText({ chatId: '998877', text: 'Замовлення' })).rejects.toEqual(
      expect.objectContaining({ name: 'TelegramBotError', code: 'INVALID_RESPONSE', status: 200 }),
    );
  });

  it.each([
    { chatId: 'supplier', text: 'Замовлення' },
    { chatId: '998877', text: '' },
    { chatId: '998877', text: 'x'.repeat(4_097) },
    { chatId: '998877', text: 'Замовлення', businessConnectionId: '../invalid' },
  ])('rejects invalid outbound input before contacting Telegram', async (input) => {
    const fetchFn = vi.fn<typeof fetch>();
    const client = new TelegramBotClient({ token, fetch: fetchFn });

    await expect(client.sendText(input)).rejects.toThrow('Invalid Telegram message input');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('does not retain the provider response body in its error object', async () => {
    const client = new TelegramBotClient({
      token,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(response({
        ok: false, error_code: 400, description: 'private provider response', extra: { token },
      }, 400)),
    });

    try {
      await client.sendText({ chatId: '998877', text: 'Замовлення' });
      throw new Error('Expected TelegramBotError');
    } catch (error) {
      expect(error).toBeInstanceOf(TelegramBotError);
      expect(JSON.stringify(error)).not.toContain('private provider response');
      expect(JSON.stringify(error)).not.toContain(token);
    }
  });
});
