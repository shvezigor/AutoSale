import { describe, expect, it, vi } from 'vitest';

import { AmbiguousRowResponseError, OpenAiAmbiguousRowClassifier } from './openai-ambiguous-row-classifier.js';

function rows(count: number) {
  return Array.from({ length: count }, (_, index) => ({ sourceRowNumber: index + 1, cells: [`Товар ${index + 1}`] }));
}

describe('OpenAiAmbiguousRowClassifier', () => {
  it('classifies only supplied row numbers in batches of at most 100', async () => {
    const create = vi.fn().mockImplementation(async (request: { input: string }) => {
      const input = JSON.parse(request.input) as { rows: Array<{ rowNumber: number }> };
      return {
        id: 'resp-rows', model: 'gpt-5.4-mini',
        output_text: JSON.stringify({ decisions: input.rows.map((row) => ({ rowNumber: row.rowNumber, kind: 'PRODUCT', confidence: 0.9 })) }),
      };
    });
    const classifier = new OpenAiAmbiguousRowClassifier({ responses: { create } }, 'gpt-5.4-mini');

    const decisions = await classifier.classify(rows(205));

    expect(create).toHaveBeenCalledTimes(3);
    expect(decisions).toHaveLength(205);
    expect(create.mock.calls.every(([request]) => JSON.parse(request.input).rows.length <= 100)).toBe(true);
  });

  it('rejects partial and invented row decisions', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'resp-invalid', model: 'gpt-5.4-mini',
      output_text: JSON.stringify({ decisions: [{ rowNumber: 999, kind: 'PRODUCT', confidence: 1 }] }),
    });
    const classifier = new OpenAiAmbiguousRowClassifier({ responses: { create } }, 'gpt-5.4-mini');

    await expect(classifier.classify(rows(1))).rejects.toBeInstanceOf(AmbiguousRowResponseError);
  });

  it('refuses unbounded ambiguous input before contacting the provider', async () => {
    const create = vi.fn();
    const classifier = new OpenAiAmbiguousRowClassifier({ responses: { create } }, 'gpt-5.4-mini');

    await expect(classifier.classify(rows(1_001))).rejects.toBeInstanceOf(AmbiguousRowResponseError);
    expect(create).not.toHaveBeenCalled();
  });
});
