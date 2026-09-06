import { describe, expect, it, vi } from 'vitest';

import type { CatalogueStructureProfile } from './catalogue-table-profiler.js';
import { OpenAiTableStructureAnalyzer, TableStructureResponseError } from './openai-table-structure-analyzer.js';

const profile: CatalogueStructureProfile = {
  totalRows: 24,
  maxColumns: 8,
  columnTypes: { 5: 'string', 7: 'mixed' },
  rows: [
    { rowNumber: 21, cells: [{ index: 5, value: 'Асортимент' }, { index: 7, value: 'Роздріб' }] },
    { rowNumber: 22, cells: [{ index: 5, value: 'Модель' }, { index: 7, value: 'Ціна, грн' }] },
    { rowNumber: 23, cells: [{ index: 5, value: '860х2050 Регіон' }, { index: 7, value: 2420 }] },
  ],
};

function response(proposal: Record<string, unknown>) {
  return { id: 'resp-structure', model: 'gpt-5.4-mini', output_text: JSON.stringify(proposal), usage: { input_tokens: 80, output_tokens: 30 } };
}

const validProposal = {
  headerStartRow: 21,
  headerEndRow: 22,
  dataStartRow: 23,
  structureConfidence: 0.97,
  columns: [
    { index: 5, label: 'Асортимент / Модель', target: 'name', confidence: 0.98 },
    { index: 7, label: 'Роздріб / Ціна, грн', target: 'price', confidence: 0.99 },
  ],
};

describe('OpenAiTableStructureAnalyzer', () => {
  it('returns a validated indexed structure and sends store false', async () => {
    const create = vi.fn().mockResolvedValue(response(validProposal));
    const analyzer = new OpenAiTableStructureAnalyzer({ responses: { create } }, 'gpt-5.4-mini');

    const result = await analyzer.analyze(profile);

    expect(result.proposal.headerStartRow).toBe(21);
    expect(result.proposal.columns.map((column) => column.index)).toEqual([5, 7]);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-5.4-mini', store: false,
      text: { format: expect.objectContaining({ type: 'json_schema', strict: true }) },
    }));
  });

  it('rejects coordinates absent from the supplied profile', async () => {
    const create = vi.fn().mockResolvedValue(response({ ...validProposal, headerStartRow: 9_999, headerEndRow: 9_999 }));
    const analyzer = new OpenAiTableStructureAnalyzer({ responses: { create } }, 'gpt-5.4-mini');

    await expect(analyzer.analyze(profile)).rejects.toBeInstanceOf(TableStructureResponseError);
  });

  it('rejects duplicate semantic targets and unobserved columns', async () => {
    const create = vi.fn().mockResolvedValue(response({
      ...validProposal,
      columns: [
        { index: 5, label: 'Назва', target: 'name', confidence: 0.9 },
        { index: 6, label: 'Інша назва', target: 'name', confidence: 0.8 },
      ],
    }));
    const analyzer = new OpenAiTableStructureAnalyzer({ responses: { create } }, 'gpt-5.4-mini');

    await expect(analyzer.analyze(profile)).rejects.toBeInstanceOf(TableStructureResponseError);
  });
});
