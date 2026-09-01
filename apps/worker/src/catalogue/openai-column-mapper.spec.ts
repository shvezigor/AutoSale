import { describe, expect, it, vi } from 'vitest';

import { OpenAiColumnMapper } from './openai-column-mapper.js';

describe('OpenAiColumnMapper', () => {
  it('classifies Ukrainian product headers using strict structured output', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'resp_columns_1',
      model: 'gpt-5.4-mini',
      output_text: JSON.stringify({
        columns: [
          { source: 'Артикул', target: 'sku', confidence: 0.98 },
          { source: 'Назва позиції', target: 'name', confidence: 0.97 },
          { source: 'Внутрішня примітка', target: 'ignore', confidence: 0.87 },
        ],
      }),
      usage: { input_tokens: 88, output_tokens: 42 },
    });
    const mapper = new OpenAiColumnMapper({ responses: { create } }, 'gpt-5.4-mini');

    const result = await mapper.suggest({
      headers: ['Артикул', 'Назва позиції', 'Внутрішня примітка'],
      primitiveTypes: { Артикул: 'string', 'Назва позиції': 'string', 'Внутрішня примітка': 'string' },
      sampleRows: [{ Артикул: 'SKU-7', 'Назва позиції': 'Куртка', 'Внутрішня примітка': 'test' }],
    });

    expect(result.proposal.columns).toEqual([
      { source: 'Артикул', target: 'sku', confidence: 0.98 },
      { source: 'Назва позиції', target: 'name', confidence: 0.97 },
      { source: 'Внутрішня примітка', target: 'ignore', confidence: 0.87 },
    ]);
    expect(result.metadata).toEqual({
      responseId: 'resp_columns_1', model: 'gpt-5.4-mini', promptVersion: 'catalogue-column-mapping-v1',
      schemaVersion: 'catalogue-mapping-proposal-v1', latencyMs: expect.any(Number), inputTokens: 88, outputTokens: 42,
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-5.4-mini', store: false,
      text: { format: expect.objectContaining({ type: 'json_schema', strict: true }) },
    }));
  });

  it('rejects an invented mapping target returned by the model', async () => {
    const mapper = new OpenAiColumnMapper({ responses: { create: vi.fn().mockResolvedValue({
      id: 'resp_columns_invalid', model: 'gpt-5.4-mini',
      output_text: JSON.stringify({ columns: [{ source: 'Артикул', target: 'inventedTarget', confidence: 0.9 }] }),
    }) } }, 'gpt-5.4-mini');

    await expect(mapper.suggest({ headers: ['Артикул'], primitiveTypes: { Артикул: 'string' }, sampleRows: [] }))
      .rejects.toThrow('OpenAI returned an invalid catalogue column mapping');
  });

  it('rejects a proposal that omits a supplied source header instead of silently losing it', async () => {
    const mapper = new OpenAiColumnMapper({ responses: { create: vi.fn().mockResolvedValue({
      id: 'resp_columns_missing', model: 'gpt-5.4-mini',
      output_text: JSON.stringify({ columns: [{ source: 'Артикул', target: 'sku', confidence: 0.9 }] }),
    }) } }, 'gpt-5.4-mini');

    await expect(mapper.suggest({
      headers: ['Артикул', 'Невідомо'], primitiveTypes: { Артикул: 'string', Невідомо: 'string' }, sampleRows: [],
    })).rejects.toThrow('OpenAI returned an invalid catalogue column mapping');
  });

  it('does not send more than five bounded samples to the provider', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'resp_columns_bounded', model: 'gpt-5.4-mini',
      output_text: JSON.stringify({ columns: [{ source: 'Колонка', target: 'ignore', confidence: 0.5 }] }),
    });
    const mapper = new OpenAiColumnMapper({ responses: { create } }, 'gpt-5.4-mini');

    await mapper.suggest({
      headers: ['Колонка'], primitiveTypes: { Колонка: 'string' },
      sampleRows: Array.from({ length: 6 }, (_, index) => ({ Колонка: `${index}`.repeat(600) })),
    });

    const request = create.mock.calls[0]?.[0] as { input: string };
    const input = JSON.parse(request.input) as { sampleRows: Array<Record<string, string>> };
    expect(input.sampleRows).toHaveLength(5);
    expect(input.sampleRows[0]?.['Колонка']).toHaveLength(500);
  });
});
