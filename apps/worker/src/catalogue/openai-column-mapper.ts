import { catalogueMappingProposalSchema, type CatalogueMappingProposal } from '@autosale/contracts';
import OpenAI from 'openai';

export const CATALOGUE_MAPPING_PROMPT_VERSION = 'catalogue-column-mapping-v1';
export const CATALOGUE_MAPPING_SCHEMA_VERSION = 'catalogue-mapping-proposal-v1';

type PrimitiveType = 'string' | 'number' | 'boolean' | 'null' | 'mixed' | 'empty';

export interface CatalogueColumnMappingInput {
  headers: string[];
  primitiveTypes: Record<string, PrimitiveType>;
  sampleRows: Array<Record<string, unknown>>;
}

interface ResponsesClient {
  responses: {
    create(input: Record<string, unknown>): Promise<{
      id: string;
      model: string;
      output_text: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    }>;
  };
}

export type CatalogueMappingSuggestion = {
  proposal: CatalogueMappingProposal;
  metadata: {
    responseId: string;
    model: string;
    promptVersion: string;
    schemaVersion: string;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
  };
};

const targetValues = ['sku', 'name', 'description', 'price', 'currency', 'stockQuantity', 'category', 'brand', 'aliases', 'color', 'size', 'imageUrls', 'active', 'attributes', 'ignore'];

// Kept structurally aligned with catalogueMappingProposalSchema. The Responses
// API accepts JSON Schema rather than Zod directly.
const mappingJsonSchema = {
  type: 'object', additionalProperties: false, required: ['columns'],
  properties: {
    columns: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['source', 'target', 'confidence'],
        properties: {
          source: { type: 'string', minLength: 1 },
          target: { type: 'string', enum: targetValues },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  },
};

export class OpenAiColumnMapper {
  constructor(private readonly client: ResponsesClient, private readonly model: string) {}

  async suggest(input: CatalogueColumnMappingInput): Promise<CatalogueMappingSuggestion> {
    const safeInput = boundedInput(input);
    const started = performance.now();
    const responses: Awaited<ReturnType<ResponsesClient['responses']['create']>>[] = [];
    const columns: CatalogueMappingProposal['columns'] = [];
    try {
      for (let offset = 0; offset < safeInput.headers.length; offset += 50) {
        const headers = safeInput.headers.slice(offset, offset + 50);
        const batch = {
          headers,
          primitiveTypes: Object.fromEntries(headers.map((header) => [header, safeInput.primitiveTypes[header]])),
          sampleRows: safeInput.sampleRows.map((row) => Object.fromEntries(headers.map((header) => [header, row[header] ?? null]))),
        };
        const response = await this.client.responses.create({
          model: this.model, store: false, max_output_tokens: 32_000,
          instructions: 'Classify catalogue column headers only. You may use the supplied primitive types and bounded samples solely to infer what each header represents. Do not transform, copy, infer, or invent product row values. Return exactly one mapping for every supplied header, with each source appearing once. target must be a supported catalogue target, and target must be ignore when evidence is insufficient.',
          input: JSON.stringify(batch),
          text: { format: { type: 'json_schema', name: 'catalogue_column_mapping', strict: true, schema: schemaForHeaders(headers) } },
        });
        responses.push(response);
        columns.push(...catalogueMappingProposalSchema.parse(JSON.parse(response.output_text)).columns);
      }
      const proposal = normalizeSemanticMappings(catalogueMappingProposalSchema.parse({ columns }));
      const sources = new Set(proposal.columns.map((column) => column.source));
      if (proposal.columns.length !== safeInput.headers.length
        || proposal.columns.some((column) => !safeInput.headers.includes(column.source))
        || sources.size !== proposal.columns.length
        || safeInput.headers.some((header) => !sources.has(header))) {
        throw new Error('invalid sources');
      }
      return {
        proposal,
        metadata: {
          responseId: responses.at(-1)?.id ?? 'unknown',
          model: responses.at(-1)?.model ?? this.model,
          promptVersion: CATALOGUE_MAPPING_PROMPT_VERSION,
          schemaVersion: CATALOGUE_MAPPING_SCHEMA_VERSION,
          latencyMs: Math.round(performance.now() - started),
          inputTokens: responses.reduce((sum, response) => sum + (response.usage?.input_tokens ?? 0), 0),
          outputTokens: responses.reduce((sum, response) => sum + (response.usage?.output_tokens ?? 0), 0),
        },
      };
    } catch {
      throw new Error('OpenAI returned an invalid catalogue column mapping');
    }
  }
}

function schemaForHeaders(headers: string[]) {
  return {
    ...mappingJsonSchema,
    properties: {
      columns: {
        ...mappingJsonSchema.properties.columns,
        items: {
          ...mappingJsonSchema.properties.columns.items,
          properties: { ...mappingJsonSchema.properties.columns.items.properties, source: { type: 'string', enum: headers } },
        },
      },
    },
  };
}

function normalizeSemanticMappings(proposal: CatalogueMappingProposal): CatalogueMappingProposal {
  if (proposal.columns.some((column) => column.target === 'name')) return proposal;
  return {
    ...proposal,
    columns: proposal.columns.map((column) =>
      column.target === 'description' && /(?:асортимент|ассортимент|assortment)/i.test(column.source)
        ? { ...column, target: 'name' as const }
        : column,
    ),
  };
}

export function createOpenAiColumnMapper(apiKey: string, model: string): OpenAiColumnMapper {
  const openai = new OpenAI({ apiKey });
  return new OpenAiColumnMapper({
    responses: {
      create: async (input) => {
        const response = await openai.responses.create(input as never);
        return {
          id: response.id, model: String(response.model), output_text: response.output_text,
          ...(response.usage ? { usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens } } : {}),
        };
      },
    },
  }, model);
}

function boundedInput(input: CatalogueColumnMappingInput): CatalogueColumnMappingInput {
  const headers = input.headers.map((header) => header.trim()).filter((header, index, all) => header.length > 0 && all.indexOf(header) === index).slice(0, 500);
  const primitiveTypes = Object.fromEntries(headers.map((header) => [header, input.primitiveTypes[header] ?? 'empty']));
  return {
    headers,
    primitiveTypes,
    sampleRows: input.sampleRows.slice(0, 5).map((row) => Object.fromEntries(headers.map((header) => [header, boundedValue(row[header])]))),
  };
}

function boundedValue(value: unknown): string | number | boolean | null {
  if (typeof value === 'string') return value.slice(0, 500);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  return null;
}
