import type { AiUsageContext } from '@autosale/database';

import { describe, expect, it, vi } from 'vitest';

import { AmbiguousRowResponseError, OpenAiAmbiguousRowClassifier } from './openai-ambiguous-row-classifier.js';

function rows(count: number) {
  return Array.from({ length: count }, (_, index) => ({ sourceRowNumber: index + 1, cells: [`Товар ${index + 1}`] }));
}

const assertCanDispatch = async () => {};
const usageContext: AiUsageContext = { tenantId: '11111111-1111-4111-8111-111111111111', operationId: '22222222-2222-4222-8222-222222222222', purpose: 'CATALOGUE_ROW_CLASSIFICATION' };

describe('OpenAiAmbiguousRowClassifier', () => {
  it('classifies only supplied row numbers in batches of at most 100', async () => {
    const create = vi.fn().mockImplementation(async (_context: AiUsageContext, request: { input: string }) => {
      const input = JSON.parse(request.input) as { rows: Array<{ rowNumber: number }> };
      return {
        id: 'resp-rows', model: 'gpt-5.4-mini',
        output_text: JSON.stringify({ decisions: input.rows.map((row) => ({ rowNumber: row.rowNumber, kind: 'PRODUCT', confidence: 0.9 })) }),
      };
    });
    const classifier = new OpenAiAmbiguousRowClassifier({ create }, 'gpt-5.4-mini');

    const decisions = await classifier.classify(rows(205), usageContext, assertCanDispatch);

    expect(create).toHaveBeenCalledTimes(3);
    expect(decisions).toHaveLength(205);
    expect(create.mock.calls.every(([context]) => context === usageContext)).toBe(true);
    expect(create.mock.calls.every(([, request]) => JSON.parse(request.input).rows.length <= 100)).toBe(true);
  });

  it('rejects partial and invented row decisions', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'resp-invalid', model: 'gpt-5.4-mini',
      output_text: JSON.stringify({ decisions: [{ rowNumber: 999, kind: 'PRODUCT', confidence: 1 }] }),
    });
    const classifier = new OpenAiAmbiguousRowClassifier({ create }, 'gpt-5.4-mini');

    await expect(classifier.classify(rows(1), usageContext, assertCanDispatch)).rejects.toBeInstanceOf(AmbiguousRowResponseError);
  });

  it('refuses unbounded ambiguous input before contacting the provider', async () => {
    const create = vi.fn();
    const classifier = new OpenAiAmbiguousRowClassifier({ create }, 'gpt-5.4-mini');

    await expect(classifier.classify(rows(1_001), usageContext, assertCanDispatch)).rejects.toBeInstanceOf(AmbiguousRowResponseError);
    expect(create).not.toHaveBeenCalled();
  });
});
