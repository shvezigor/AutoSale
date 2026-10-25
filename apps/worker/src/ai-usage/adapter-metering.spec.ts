import type { AiProviderUsageStore, AiUsageContext } from '@autosale/database';
import { describe, expect, it, vi } from 'vitest';

import { OpenAiAmbiguousRowClassifier } from '../catalogue/openai-ambiguous-row-classifier.js';
import { OpenAiColumnMapper } from '../catalogue/openai-column-mapper.js';
import { OpenAiTableStructureAnalyzer } from '../catalogue/openai-table-structure-analyzer.js';
import { OpenAiOrderRecognizer } from '../orders/openai-order-recognizer.js';
import { OpenAiReplyDraftGenerator } from '../reply-drafts/openai-reply-draft-generator.js';
import { createWorkerResponses } from './worker-responses.js';
import type { MeteredResponses, ResponsesRequest } from './metered-responses.js';

const base = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  operationId: '22222222-2222-4222-8222-222222222222',
};
const style = { companyName: 'Fictional shop', tone: 'NEUTRAL' as const, addressForm: 'FORMAL_YOU' as const, guidance: '' };

function fixture(enabled = true, output: (request: ResponsesRequest) => string = () => '{invalid') {
  const events: string[] = [];
  const store = {
    start: vi.fn<AiProviderUsageStore['start']>().mockImplementation(async () => { events.push('start'); }),
    finalize: vi.fn<AiProviderUsageStore['finalize']>().mockImplementation(async () => { events.push('finalize'); return true; }),
  };
  const create = vi.fn().mockImplementation(async (request: ResponsesRequest) => {
    events.push('provider');
    return { id: 'resp-fictional', model: 'fictional-model', output_text: output(request),
      usage: { input_tokens: 8, output_tokens: 3 } };
  });
  const boundary = createWorkerResponses('fictional-key', enabled, store, vi.fn(), () => ({ responses: { create } }));
  return { store, create, boundary, events };
}

const calls: Array<[AiUsageContext['purpose'], (boundary: MeteredResponses, context: AiUsageContext) => Promise<unknown>]> = [
  ['ORDER_RECOGNITION', (boundary, usageContext) => new OpenAiOrderRecognizer(boundary, 'fictional-model')
    .recognize({ usageContext, messages: [], products: [], recognitionMode: 'TRIGGERED_ORDER' })],
  ['ORDER_INTENT', (boundary, usageContext) => new OpenAiOrderRecognizer(boundary, 'fictional-model')
    .recognize({ usageContext, messages: [], products: [], recognitionMode: 'CONVERSATIONAL_INTENT' })],
  ['REPLY_DRAFT', (boundary, usageContext) => new OpenAiReplyDraftGenerator(boundary, 'fictional-model')
    .generate({ usageContext, latestInbound: 'Fictional question', recentContext: [], style, sources: [] })],
  ['CATALOGUE_STRUCTURE', (boundary, usageContext) => new OpenAiTableStructureAnalyzer(boundary, 'fictional-model')
    .analyze({ usageContext, totalRows: 2, maxColumns: 1, columnTypes: { 0: 'string' }, rows: [] })],
  ['CATALOGUE_COLUMN_MAPPING', (boundary, usageContext) => new OpenAiColumnMapper(boundary, 'fictional-model')
    .suggest({ usageContext, headers: ['Fictional name'], primitiveTypes: {}, sampleRows: [] })],
  ['CATALOGUE_ROW_CLASSIFICATION', (boundary, usageContext) => new OpenAiAmbiguousRowClassifier(boundary, 'fictional-model')
    .classify([{ sourceRowNumber: 1, cells: ['Fictional row'] }], usageContext)],
];

describe('adapter metering integration', () => {
  it.each(calls)('records %s before parsing an invalid response and isolates context from prompts', async (purpose, call) => {
    const f = fixture();
    const context = { ...base, purpose };
    await expect(call(f.boundary, context)).rejects.toThrow();
    expect(f.events).toEqual(['start', 'provider', 'finalize']);
    expect(f.store.start).toHaveBeenCalledWith(context, 'fictional-model', expect.any(String), expect.any(Date));
    expect(f.store.finalize).toHaveBeenCalledWith(context, expect.any(String), 'REPORTED',
      { inputTokens: 8, outputTokens: 3, cachedInputTokens: null }, 'fictional-model', expect.any(Date));
    expect(JSON.stringify(f.create.mock.calls)).not.toContain(base.tenantId);
    expect(JSON.stringify(f.create.mock.calls)).not.toContain(base.operationId);
    expect(JSON.stringify(f.create.mock.calls)).not.toContain('usageContext');
  });

  it.each(calls)('keeps %s provider behavior available without collecting while disabled', async (purpose, call) => {
    const f = fixture(false);
    await expect(call(f.boundary, { ...base, purpose })).rejects.toThrow();
    expect(f.create).toHaveBeenCalledOnce();
    expect(f.store.start).not.toHaveBeenCalled();
    expect(f.store.finalize).not.toHaveBeenCalled();
  });

  it('creates two independent attempts for 51 columns and two more on an explicit retry', async () => {
    const f = fixture(true, (request) => {
      const { headers } = JSON.parse(String(request.input)) as { headers: string[] };
      return JSON.stringify({ columns: headers.map((source) => ({ source, target: 'ignore', confidence: 0.5 })) });
    });
    const mapper = new OpenAiColumnMapper(f.boundary, 'fictional-model');
    const input = { usageContext: { ...base, purpose: 'CATALOGUE_COLUMN_MAPPING' as const },
      headers: Array.from({ length: 51 }, (_, index) => 'Fictional column ' + index), primitiveTypes: {}, sampleRows: [] };
    expect((await mapper.suggest(input)).proposal.columns).toHaveLength(51);
    expect(f.store.start).toHaveBeenCalledTimes(2);
    await mapper.suggest(input);
    const ids = f.store.start.mock.calls.map(([, , id]) => id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    expect(f.store.finalize.mock.calls.map(([, id]) => id)).toEqual(ids);
  });

  it('creates two independent attempts for 101 ambiguous rows', async () => {
    const f = fixture(true, (request) => {
      const { rows } = JSON.parse(String(request.input)) as { rows: Array<{ rowNumber: number }> };
      return JSON.stringify({ decisions: rows.map(({ rowNumber }) => ({ rowNumber, kind: 'SKIP', confidence: 0.9 })) });
    });
    const rows = Array.from({ length: 101 }, (_, index) => ({ sourceRowNumber: index + 1, cells: ['Fictional row'] }));
    expect(await new OpenAiAmbiguousRowClassifier(f.boundary, 'fictional-model')
      .classify(rows, { ...base, purpose: 'CATALOGUE_ROW_CLASSIFICATION' })).toHaveLength(101);
    expect(f.store.start).toHaveBeenCalledTimes(2);
    expect(new Set(f.store.start.mock.calls.map(([, , id]) => id)).size).toBe(2);
    expect(f.store.finalize).toHaveBeenCalledTimes(2);
  });
});
