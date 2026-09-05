import { describe, expect, it, vi } from 'vitest';

import { OpenAiColumnMapper } from './openai-column-mapper.js';

describe('OpenAiColumnMapper', () => {
  it('normalizes an assortment column to the product name when the model calls it a description', async () => {
    const mapper = new OpenAiColumnMapper({ responses: { create: vi.fn().mockResolvedValue({
      id: 'resp_assortment', model: 'gpt-5.4-mini',
      output_text: JSON.stringify({ columns: [
        { source: 'ассортимент', target: 'description', confidence: 0.96 },
        { source: 'оптовая цена €', target: 'price', confidence: 0.99 },
      ] }),
    }) } }, 'gpt-5.4-mini');

    const result = await mapper.suggest({
      headers: ['ассортимент', 'оптовая цена €'],
      primitiveTypes: { ассортимент: 'string', 'оптовая цена €': 'number' },
      sampleRows: [{ ассортимент: 'Двері Неаполь', 'оптовая цена €': 158 }],
    });

    expect(result.proposal.columns).toEqual([
      { source: 'ассортимент', target: 'name', confidence: 0.96 },
      { source: 'оптовая цена €', target: 'price', confidence: 0.99 },
    ]);
  });

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
      model: 'gpt-5.4-mini', store: false, max_output_tokens: 32_000,
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

  it('maps wide catalogues in complete batches and merges every source', async () => {
    const create = vi.fn().mockImplementation(async (request: { input: string }) => {
      const batch = JSON.parse(request.input) as { headers: string[] };
      return { id: `resp-${create.mock.calls.length}`, model: 'gpt-5.4-mini', output_text: JSON.stringify({ columns: batch.headers.map((source) => ({ source, target: 'ignore', confidence: 0.7 })) }) };
    });
    const headers = Array.from({ length: 120 }, (_, index) => `Поле ${index}`);
    const result = await new OpenAiColumnMapper({ responses: { create } }, 'gpt-5.4-mini').suggest({ headers, primitiveTypes: Object.fromEntries(headers.map((header) => [header, 'string'])), sampleRows: [] });
    expect(create).toHaveBeenCalledTimes(3);
    expect(result.proposal.columns.map((column) => column.source)).toEqual(headers);
  });
});
