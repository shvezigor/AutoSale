import { ambiguousRowClassificationSchema, type AmbiguousRowClassification, type RawCatalogueCell } from '@autosale/contracts';
import OpenAI from 'openai';
import { z } from 'zod';

import type { ClassifiedCatalogueRow } from './catalogue-row-classifier.js';

interface ResponsesClient {
  responses: {
    create(input: Record<string, unknown>): Promise<{ id: string; model: string; output_text: string }>;
  };
}

export class AmbiguousRowProviderError extends Error {
  constructor(readonly status: number | null) {
    super('Ambiguous row provider request failed');
    this.name = 'AmbiguousRowProviderError';
  }
}

export class AmbiguousRowResponseError extends Error {
  constructor() {
    super('Ambiguous row provider returned an invalid response');
    this.name = 'AmbiguousRowResponseError';
  }
}

const resultSchema = z.object({ decisions: z.array(ambiguousRowClassificationSchema).max(100) }).strict();
const instructions = 'Classify each supplied row as PRODUCT or SKIP. Never return or modify cell values. Category labels, repeated headers, contacts, notes, and totals are SKIP. Return exactly one decision for every original rowNumber.';

export class OpenAiAmbiguousRowClassifier {
  constructor(private readonly client: ResponsesClient, private readonly model: string) {}

  async classify(rows: ClassifiedCatalogueRow[]): Promise<AmbiguousRowClassification[]> {
    if (rows.length > 1_000) throw new AmbiguousRowResponseError();
    const decisions: AmbiguousRowClassification[] = [];
    for (let offset = 0; offset < rows.length; offset += 100) {
      const batch = rows.slice(offset, offset + 100);
      const rowNumbers = batch.map((row) => row.sourceRowNumber);
      let response: Awaited<ReturnType<ResponsesClient['responses']['create']>>;
      try {
        response = await this.client.responses.create({
          model: this.model,
          store: false,
          max_output_tokens: 8_000,
          instructions,
          input: JSON.stringify({ rows: batch.map((row) => ({ rowNumber: row.sourceRowNumber, cells: row.cells.map(boundValue) })) }),
          text: { format: { type: 'json_schema', name: 'catalogue_row_classification', strict: true, schema: schemaForRows(rowNumbers) } },
        });
      } catch (error) {
        throw new AmbiguousRowProviderError(providerStatus(error));
      }
      try {
        const parsed = resultSchema.parse(JSON.parse(response.output_text)).decisions;
        const returned = new Set(parsed.map((decision) => decision.rowNumber));
        if (parsed.length !== batch.length || returned.size !== batch.length || rowNumbers.some((row) => !returned.has(row))) {
          throw new Error('Incomplete or invented row decisions');
        }
        decisions.push(...parsed);
      } catch {
        throw new AmbiguousRowResponseError();
      }
    }
    return decisions;
  }
}

function schemaForRows(rowNumbers: number[]) {
  return {
    type: 'object', additionalProperties: false, required: ['decisions'],
    properties: {
      decisions: {
        type: 'array', minItems: rowNumbers.length, maxItems: rowNumbers.length,
        items: {
          type: 'object', additionalProperties: false, required: ['rowNumber', 'kind', 'confidence'],
          properties: {
            rowNumber: { type: 'integer', enum: rowNumbers },
            kind: { type: 'string', enum: ['PRODUCT', 'SKIP'] },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
          },
        },
      },
    },
  };
}

function boundValue(value: RawCatalogueCell): RawCatalogueCell {
  return typeof value === 'string' ? value.slice(0, 500) : value;
}

function providerStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('status' in error)) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' && Number.isInteger(status) ? status : null;
}

export function createOpenAiAmbiguousRowClassifier(apiKey: string, model: string): OpenAiAmbiguousRowClassifier {
  const openai = new OpenAI({ apiKey });
  return new OpenAiAmbiguousRowClassifier({
    responses: { create: async (input) => {
      const response = await openai.responses.create(input as never);
      return { id: response.id, model: String(response.model), output_text: response.output_text };
    } },
  }, model);
}
