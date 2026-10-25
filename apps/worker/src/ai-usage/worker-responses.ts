import OpenAI from 'openai';
import type { AiProviderUsageStore } from '@autosale/database';

import { createMeteredResponses, createOpenAiResponsesClient, type AiUsageSignal, type MeteredResponses, type ResponsesSdk } from './metered-responses.js';

/** Deployment is safe by default: collection is separately authorized at runtime. */
export function createWorkerResponses(
  apiKey: string,
  collectionEnabled: boolean,
  store: Pick<AiProviderUsageStore, 'start' | 'finalize'>,
  signal: (label: AiUsageSignal) => void,
  factory: (options: { apiKey: string; maxRetries?: 0 }) => ResponsesSdk = (options) => new OpenAI(options),
): MeteredResponses {
  if (collectionEnabled) {
    return createMeteredResponses(store, createOpenAiResponsesClient(apiKey, factory), signal);
  }
  // Retain the existing SDK retry behavior while collection is disabled.
  const sdk = factory({ apiKey });
  return { create: (_context, request) => sdk.responses.create({ ...request, store: false }) };
}
