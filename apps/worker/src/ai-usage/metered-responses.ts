import { randomUUID } from 'node:crypto';

import type { AiProviderUsage, AiProviderUsageStore, AiUsageContext } from '@autosale/database';
import OpenAI from 'openai';

export type AiUsageSignal = 'start_failed' | 'finalize_failed';
export type ResponsesRequest = OpenAI.Responses.ResponseCreateParamsNonStreaming & { model: string };
export interface ResponsesSdk {
  responses: {
    create(request: OpenAI.Responses.ResponseCreateParamsNonStreaming): Promise<OpenAI.Responses.Response>;
  };
}
export interface MeteredResponses {
  create(context: AiUsageContext, request: ResponsesRequest): Promise<OpenAI.Responses.Response>;
}

/** One application invocation must not conceal multiple chargeable SDK attempts. */
export function createOpenAiResponsesClient(
  apiKey: string,
  factory: (options: { apiKey: string; maxRetries: 0 }) => ResponsesSdk = (options) => new OpenAI(options),
): ResponsesSdk {
  return factory({ apiKey, maxRetries: 0 });
}

export function createMeteredResponses(
  store: Pick<AiProviderUsageStore, 'start' | 'finalize'>,
  sdk: ResponsesSdk,
  signal: (label: AiUsageSignal) => void,
): MeteredResponses {
  function emit(label: AiUsageSignal): void {
    try { signal(label); } catch { /* Telemetry must not replace the product result. */ }
  }

  return {
    async create(context, request) {
      const attemptId = randomUUID();
      let recorded = false;
      try {
        await store.start(context, request.model, attemptId, new Date());
        recorded = true;
      } catch {
        emit('start_failed');
      }

      let response: OpenAI.Responses.Response;
      try {
        response = await sdk.responses.create({ ...request, store: false });
      } catch (providerError) {
        if (recorded) {
          try {
            const finalized = await store.finalize(context, attemptId, 'CHARGE_UNKNOWN',
              { inputTokens: null, outputTokens: null, cachedInputTokens: null }, null, new Date(),
              providerError instanceof OpenAI.APIConnectionTimeoutError ? 'TIMEOUT' : 'TRANSPORT_ERROR');
            if (!finalized) emit('finalize_failed');
          } catch {
            emit('finalize_failed');
          }
        }
        throw providerError;
      }

      if (recorded) {
        try {
          const usage = normalizeUsage(response.usage);
          const outcome = usage.inputTokens !== null && usage.outputTokens !== null ? 'REPORTED' : 'USAGE_MISSING';
          const finalized = await store.finalize(context, attemptId, outcome, usage, String(response.model), new Date());
          if (!finalized) emit('finalize_failed');
        } catch {
          emit('finalize_failed');
        }
      }
      return response;
    },
  };
}

function normalizeUsage(value: unknown): AiProviderUsage {
  const usage = record(value);
  let inputTokens = tokenCount(usage?.input_tokens);
  const outputTokens = tokenCount(usage?.output_tokens);
  let cachedInputTokens = tokenCount(record(usage?.input_tokens_details)?.cached_tokens);
  if (inputTokens === null) {
    cachedInputTokens = null;
  } else if (cachedInputTokens !== null && cachedInputTokens > inputTokens) {
    // Contradictory input evidence cannot be reported as complete known usage.
    inputTokens = null;
    cachedInputTokens = null;
  }
  return { inputTokens, outputTokens, cachedInputTokens };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function tokenCount(value: unknown): number | null {
  // PostgreSQL INTEGER is the ledger's persisted bound, not JS's safe-integer limit.
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 2_147_483_647
    ? value : null;
}
