import type { AiProviderUsageStore, AiUsageContext } from '@autosale/database';
import OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';

import { createMeteredResponses, createOpenAiResponsesClient } from './metered-responses.js';

const context: AiUsageContext = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  operationId: '00000000-0000-4000-8000-000000000002',
  purpose: 'ORDER_RECOGNITION',
};
const request = { model: 'fictional-requested-model', input: 'Fictional private prompt', store: false };
const noUsage = { inputTokens: null, outputTokens: null, cachedInputTokens: null };

function response(usage?: unknown): OpenAI.Responses.Response {
  return {
    id: 'resp_fictional', object: 'response', created_at: 1, status: 'completed',
    model: 'fictional-returned-model', output_text: 'invalid JSON', output: [],
    error: null, incomplete_details: null, instructions: null, metadata: null,
    parallel_tool_calls: false, temperature: null, top_p: null, tools: [], tool_choice: 'auto',
    ...(usage === undefined ? {} : { usage: usage as OpenAI.Responses.ResponseUsage }),
  };
}

function fixture(result = response({
  input_tokens: 80, output_tokens: 12, input_tokens_details: { cached_tokens: 30 },
  output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 92,
})) {
  const events: string[] = [];
  const store = {
    start: vi.fn<AiProviderUsageStore['start']>().mockImplementation(async () => { events.push('start'); }),
    finalize: vi.fn<AiProviderUsageStore['finalize']>().mockImplementation(async () => {
      events.push('finalize');
      return true;
    }),
  };
  const sdk = { responses: { create: vi.fn().mockImplementation(async () => {
    events.push('provider');
    return result;
  }) } };
  const signal = vi.fn();
  const metered = createMeteredResponses(store, sdk, signal);
  return { store, sdk, signal, metered, events, result };
}

describe('metered Responses transport', () => {
  it('awaits start and finalize around one dispatch before returning unparsed output', async () => {
    const f = fixture();
    let finishStart!: () => void;
    let finishFinalize!: () => void;
    const startGate = new Promise<void>((resolve) => { finishStart = resolve; });
    const finalizeGate = new Promise<void>((resolve) => { finishFinalize = resolve; });
    f.store.start.mockImplementation(async () => {
      await startGate;
      f.events.push('start');
    });
    f.store.finalize.mockImplementation(async () => {
      await finalizeGate;
      f.events.push('finalize');
      return true;
    });

    const pending = f.metered.create(context, request).then((result) => {
      f.events.push('returned');
      return result;
    });
    await Promise.resolve();
    expect(f.sdk.responses.create).not.toHaveBeenCalled();
    finishStart();
    await vi.waitFor(() => expect(f.store.finalize).toHaveBeenCalledTimes(1));
    expect(f.events).toEqual(['start', 'provider']);
    finishFinalize();
    const result = await pending;

    expect(result).toBe(f.result);
    expect(f.events).toEqual(['start', 'provider', 'finalize', 'returned']);
    expect(f.sdk.responses.create).toHaveBeenCalledExactlyOnceWith(request);
    expect(f.store.start).toHaveBeenCalledExactlyOnceWith(context, 'fictional-requested-model', expect.any(String), expect.any(Date));
    const attemptId = f.store.start.mock.calls[0]![2];
    expect(attemptId).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
    expect(f.store.finalize).toHaveBeenCalledExactlyOnceWith(context, attemptId, 'REPORTED',
      { inputTokens: 80, outputTokens: 12, cachedInputTokens: 30 }, 'fictional-returned-model', expect.any(Date));
    expect(() => JSON.parse(result.output_text)).toThrow();
    expect(f.signal).not.toHaveBeenCalled();
  });

  it('generates a new attempt for each explicit call in the same operation', async () => {
    const f = fixture();
    await f.metered.create(context, request);
    await f.metered.create(context, request);

    expect(f.sdk.responses.create).toHaveBeenCalledTimes(2);
    const ids = f.store.start.mock.calls.map((call) => call[2]);
    expect(new Set(ids).size).toBe(2);
    expect(f.store.finalize.mock.calls.map((call) => call[1])).toEqual(ids);
  });

  it.each([
    { label: 'explicit zero', usage: { input_tokens: 0, output_tokens: 0, input_tokens_details: { cached_tokens: 0 } },
      outcome: 'REPORTED', counts: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 } },
    { label: 'missing usage', usage: undefined, outcome: 'USAGE_MISSING', counts: noUsage },
    { label: 'null usage', usage: null, outcome: 'USAGE_MISSING', counts: noUsage },
    { label: 'missing output', usage: { input_tokens: 80, input_tokens_details: { cached_tokens: 30 } },
      outcome: 'USAGE_MISSING', counts: { inputTokens: 80, outputTokens: null, cachedInputTokens: 30 } },
    { label: 'missing input', usage: { output_tokens: 12, input_tokens_details: { cached_tokens: 30 } },
      outcome: 'USAGE_MISSING', counts: { inputTokens: null, outputTokens: 12, cachedInputTokens: null } },
    { label: 'optional cached breakdown', usage: { input_tokens: 80, output_tokens: 12 },
      outcome: 'REPORTED', counts: { inputTokens: 80, outputTokens: 12, cachedInputTokens: null } },
    { label: 'cache exceeds input', usage: { input_tokens: 80, output_tokens: 12, input_tokens_details: { cached_tokens: 81 } },
      outcome: 'USAGE_MISSING', counts: { inputTokens: null, outputTokens: 12, cachedInputTokens: null } },
    { label: 'maximum PostgreSQL integer', usage: { input_tokens: 2_147_483_647, output_tokens: 0 },
      outcome: 'REPORTED', counts: { inputTokens: 2_147_483_647, outputTokens: 0, cachedInputTokens: null } },
  ])('records $label without inventing usage', async ({ usage, outcome, counts }) => {
    const f = fixture(response(usage));
    await expect(f.metered.create(context, request)).resolves.toBe(f.result);

    expect(f.store.finalize).toHaveBeenCalledExactlyOnceWith(context, expect.any(String), outcome,
      counts, 'fictional-returned-model', expect.any(Date));
    expect(f.sdk.responses.create).toHaveBeenCalledTimes(1);
    expect(f.signal).not.toHaveBeenCalled();
  });

  it.each([-1, 0.5, NaN, Infinity, 2_147_483_648, '80'])('rejects invalid input count %s while retaining valid output', async (invalid) => {
    const f = fixture(response({ input_tokens: invalid, output_tokens: 12, input_tokens_details: { cached_tokens: 1 } }));
    await f.metered.create(context, request);

    expect(f.store.finalize).toHaveBeenCalledWith(context, expect.any(String), 'USAGE_MISSING',
      { inputTokens: null, outputTokens: 12, cachedInputTokens: null }, 'fictional-returned-model', expect.any(Date));
  });

  it.each([-1, 0.5, NaN, Infinity, 2_147_483_648, '12'])('rejects invalid output count %s while retaining valid input', async (invalid) => {
    const f = fixture(response({ input_tokens: 80, output_tokens: invalid, input_tokens_details: { cached_tokens: 30 } }));
    await f.metered.create(context, request);

    expect(f.store.finalize).toHaveBeenCalledWith(context, expect.any(String), 'USAGE_MISSING',
      { inputTokens: 80, outputTokens: null, cachedInputTokens: 30 }, 'fictional-returned-model', expect.any(Date));
  });

  it.each([-1, 0.5, NaN, Infinity, 2_147_483_648, '30'])('rejects invalid cached count %s as unknown breakdown', async (invalid) => {
    const f = fixture(response({ input_tokens: 80, output_tokens: 12, input_tokens_details: { cached_tokens: invalid } }));
    await f.metered.create(context, request);

    expect(f.store.finalize).toHaveBeenCalledWith(context, expect.any(String), 'REPORTED',
      { inputTokens: 80, outputTokens: 12, cachedInputTokens: null }, 'fictional-returned-model', expect.any(Date));
  });

  it.each([undefined, true])('enforces store:false when caller supplies %s', async (store) => {
    const f = fixture();
    const input = { model: request.model, input: request.input, ...(store === undefined ? {} : { store }) };
    await f.metered.create(context, input);

    expect(f.sdk.responses.create).toHaveBeenCalledExactlyOnceWith(request);
    expect(input.store).toBe(store);
  });

  it.each([
    { label: 'transport error', error: new Error('Fictional private provider error'), category: 'TRANSPORT_ERROR' },
    { label: 'SDK timeout', error: new OpenAI.APIConnectionTimeoutError(), category: 'TIMEOUT' },
  ])('finalizes $label as charge unknown and rethrows the original error', async ({ error, category }) => {
    const f = fixture();
    f.sdk.responses.create.mockImplementation(async () => { f.events.push('provider'); throw error; });

    await expect(f.metered.create(context, request)).rejects.toBe(error);
    expect(f.events).toEqual(['start', 'provider', 'finalize']);
    expect(f.sdk.responses.create).toHaveBeenCalledTimes(1);
    expect(f.store.finalize).toHaveBeenCalledExactlyOnceWith(context, expect.any(String), 'CHARGE_UNKNOWN',
      noUsage, null, expect.any(Date), category);
    expect(f.signal).not.toHaveBeenCalled();
  });

  it.each(['success', 'error'] as const)('preserves provider %s after start storage failure', async (outcome) => {
    const f = fixture();
    const error = new Error('Fictional private provider error');
    f.store.start.mockRejectedValue(new Error(request.input));
    if (outcome === 'error') f.sdk.responses.create.mockRejectedValue(error);

    const result = f.metered.create(context, request);
    if (outcome === 'success') await expect(result).resolves.toBe(f.result);
    else await expect(result).rejects.toBe(error);
    expect(f.sdk.responses.create).toHaveBeenCalledTimes(1);
    expect(f.store.finalize).not.toHaveBeenCalled();
    expect(f.signal.mock.calls).toEqual([['start_failed']]);
    expect(JSON.stringify(f.signal.mock.calls)).not.toContain(request.input);
    expect(JSON.stringify(f.signal.mock.calls)).not.toContain(context.operationId);
    expect(JSON.stringify(f.signal.mock.calls)).not.toContain(context.tenantId);
  });

  it.each(['success', 'error'] as const)('preserves provider %s after finalize storage failure', async (outcome) => {
    const f = fixture();
    const error = new Error('Fictional private provider error');
    f.store.finalize.mockRejectedValue(new Error(request.input));
    if (outcome === 'error') f.sdk.responses.create.mockRejectedValue(error);

    const result = f.metered.create(context, request);
    if (outcome === 'success') await expect(result).resolves.toBe(f.result);
    else await expect(result).rejects.toBe(error);
    expect(f.sdk.responses.create).toHaveBeenCalledTimes(1);
    expect(f.store.finalize).toHaveBeenCalledTimes(1);
    expect(f.signal.mock.calls).toEqual([['finalize_failed']]);
    expect(JSON.stringify(f.signal.mock.calls)).not.toContain(request.input);
    expect(JSON.stringify(f.signal.mock.calls)).not.toContain(context.operationId);
    expect(JSON.stringify(f.signal.mock.calls)).not.toContain(context.tenantId);
  });

  it('signals a finalization that did not persist a row', async () => {
    const f = fixture();
    f.store.finalize.mockResolvedValue(false);
    await expect(f.metered.create(context, request)).resolves.toBe(f.result);
    expect(f.signal.mock.calls).toEqual([['finalize_failed']]);
  });

  it.each(['start', 'finalize'] as const)('preserves the response when a %s failure signal throws', async (stage) => {
    const f = fixture();
    if (stage === 'start') f.store.start.mockRejectedValue(new Error('Fictional database outage'));
    else f.store.finalize.mockRejectedValue(new Error('Fictional database outage'));
    f.signal.mockImplementation(() => { throw new Error('Fictional telemetry outage'); });

    await expect(f.metered.create(context, request)).resolves.toBe(f.result);
    expect(f.sdk.responses.create).toHaveBeenCalledTimes(1);
  });
});

describe('OpenAI Responses client creation', () => {
  it('disables hidden SDK retries through the injectable client factory', () => {
    const f = fixture();
    const factory = vi.fn().mockReturnValue(f.sdk);
    expect(createOpenAiResponsesClient('fictional-api-key', factory)).toBe(f.sdk);
    expect(factory).toHaveBeenCalledExactlyOnceWith({ apiKey: 'fictional-api-key', maxRetries: 0 });
  });
});
