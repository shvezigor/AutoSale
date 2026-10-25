import { tableStructureProposalSchema, type TableStructureProposal } from '@autosale/contracts';
import type { AiUsageContext } from '@autosale/database';
import type { MeteredResponses } from '../ai-usage/metered-responses.js';

import type { CatalogueStructureProfile } from './catalogue-table-profiler.js';

export const TABLE_STRUCTURE_PROMPT_VERSION = 'catalogue-table-structure-v1';
export const TABLE_STRUCTURE_SCHEMA_VERSION = 'table-structure-proposal-v1';

export interface TableStructureSuggestion {
  proposal: TableStructureProposal;
  metadata: {
    responseId: string;
    model: string;
    promptVersion: string;
    schemaVersion: string;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
  };
}

export class TableStructureProviderError extends Error {
  constructor(readonly status: number | null) {
    super('Table structure provider request failed');
    this.name = 'TableStructureProviderError';
  }
}

export class TableStructureResponseError extends Error {
  constructor() {
    super('Table structure provider returned an invalid response');
    this.name = 'TableStructureResponseError';
  }
}

const targetValues = [
  'sku', 'name', 'description', 'price', 'currency', 'stockQuantity', 'category', 'brand',
  'aliases', 'color', 'size', 'imageUrls', 'active', 'attributes', 'ignore',
];

const structureJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['headerStartRow', 'headerEndRow', 'dataStartRow', 'structureConfidence', 'columns'],
  properties: {
    headerStartRow: { type: 'integer', minimum: 1 },
    headerEndRow: { type: 'integer', minimum: 1 },
    dataStartRow: { type: 'integer', minimum: 1 },
    structureConfidence: { type: 'number', minimum: 0, maximum: 1 },
    columns: {
      type: 'array', minItems: 1, maxItems: 500,
      items: {
        type: 'object', additionalProperties: false,
        required: ['index', 'label', 'target', 'confidence'],
        properties: {
          index: { type: 'integer', minimum: 0, maximum: 499 },
          label: { type: 'string', minLength: 1, maxLength: 300 },
          target: { type: 'string', enum: targetValues },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  },
};

const instructions = 'Identify catalogue structure only. Return original one-based row numbers and zero-based column indexes. Combine at most three adjacent header rows. Map semantic columns without changing cell values. Treat titles, contacts, currency notes, category labels, and repeated headers as non-product structure. Use low confidence when evidence is insufficient.';

export class OpenAiTableStructureAnalyzer {
  constructor(private readonly client: MeteredResponses, private readonly model: string) {}

  async analyze(input: CatalogueStructureProfile & { usageContext: AiUsageContext; assertCanDispatch: () => Promise<void> }): Promise<TableStructureSuggestion> {
    const { usageContext: _usageContext, assertCanDispatch, ...profile } = input;
    const started = performance.now();
    let response: Awaited<ReturnType<MeteredResponses['create']>>;
    await assertCanDispatch();
    try {
      response = await this.client.create(input.usageContext, {
        model: this.model,
        store: false,
        max_output_tokens: 16_000,
        instructions,
        input: JSON.stringify(profile),
        text: { format: { type: 'json_schema', name: 'catalogue_table_structure', strict: true, schema: structureJsonSchema } },
      });
    } catch (error) {
      throw new TableStructureProviderError(providerStatus(error));
    }

    try {
      const proposal = tableStructureProposalSchema.parse(JSON.parse(response.output_text));
      validateCoordinates(profile, proposal);
      return {
        proposal,
        metadata: {
          responseId: response.id,
          model: response.model,
          promptVersion: TABLE_STRUCTURE_PROMPT_VERSION,
          schemaVersion: TABLE_STRUCTURE_SCHEMA_VERSION,
          latencyMs: Math.round(performance.now() - started),
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
        },
      };
    } catch (error) {
      if (error instanceof TableStructureProviderError) throw error;
      throw new TableStructureResponseError();
    }
  }
}

function validateCoordinates(profile: CatalogueStructureProfile, proposal: TableStructureProposal): void {
  const suppliedRows = new Set(profile.rows.map((row) => row.rowNumber));
  for (let rowNumber = proposal.headerStartRow; rowNumber <= proposal.headerEndRow; rowNumber += 1) {
    if (!suppliedRows.has(rowNumber)) throw new Error('Header coordinate was not supplied');
  }
  if (!suppliedRows.has(proposal.dataStartRow)) throw new Error('Data coordinate was not supplied');

  const suppliedColumns = new Set(profile.rows.flatMap((row) => row.cells.map((cell) => cell.index)));
  const indexes = new Set<number>();
  const targets = new Set<string>();
  for (const column of proposal.columns) {
    if (!suppliedColumns.has(column.index) || indexes.has(column.index)) throw new Error('Column coordinate was not supplied or is duplicated');
    indexes.add(column.index);
    if (column.target !== 'ignore' && targets.has(column.target)) throw new Error('Semantic target is duplicated');
    if (column.target !== 'ignore') targets.add(column.target);
  }
}

function providerStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('status' in error)) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' && Number.isInteger(status) ? status : null;
}

export function createOpenAiTableStructureAnalyzer(client: MeteredResponses, model: string): OpenAiTableStructureAnalyzer {
  return new OpenAiTableStructureAnalyzer(client, model);
}
