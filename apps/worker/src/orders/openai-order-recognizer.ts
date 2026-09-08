import OpenAI from 'openai';
import { z } from 'zod';
import { INSTAGRAM_ORDER_PROMPT_VERSION } from '@autosale/contracts';

export const ORDER_RECOGNITION_PROMPT_VERSION = INSTAGRAM_ORDER_PROMPT_VERSION;

const nullableText = z.string().nullable();

export const recognizedOrderSchema = z.object({
  isOrder: z.boolean(),
  customer: z.object({
    name: nullableText,
    phone: nullableText,
    instagramUsername: nullableText,
  }),
  delivery: z.object({
    city: nullableText,
    address: nullableText,
    novaPoshtaBranch: nullableText,
  }),
  items: z.array(
    z.object({
      catalogId: nullableText,
      originalText: z.string(),
      quantity: z.number().int().positive(),
      color: nullableText,
      size: nullableText,
      confidence: z.number().min(0).max(1),
    }),
  ),
  missingFields: z.array(z.string()),
  overallConfidence: z.number().min(0).max(1),
});

export type RecognizedOrder = z.infer<typeof recognizedOrderSchema>;

export interface OrderRecognitionInput {
  messages: Array<{ id: string; direction: string; text: string | null }>;
  products: Array<{ id: string; name: string; aliases: string[] }>;
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

const orderJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'isOrder',
    'customer',
    'delivery',
    'items',
    'missingFields',
    'overallConfidence',
  ],
  properties: {
    isOrder: { type: 'boolean' },
    customer: nullableFields(['name', 'phone', 'instagramUsername']),
    delivery: nullableFields(['city', 'address', 'novaPoshtaBranch']),
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'catalogId',
          'originalText',
          'quantity',
          'color',
          'size',
          'confidence',
        ],
        properties: {
          catalogId: { type: ['string', 'null'] },
          originalText: { type: 'string' },
          quantity: { type: 'integer', minimum: 1 },
          color: { type: ['string', 'null'] },
          size: { type: ['string', 'null'] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
    missingFields: { type: 'array', items: { type: 'string' } },
    overallConfidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

export class OpenAiOrderRecognizer {
  constructor(
    private readonly client: ResponsesClient,
    private readonly model: string,
  ) {}

  async recognize(input: OrderRecognitionInput): Promise<{
    order: RecognizedOrder;
    metadata: {
      responseId: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
    };
  }> {
    const anchorMessageId = input.messages.at(-1)?.id ?? null;
    const response = await this.client.responses.create({
      model: this.model,
      store: false,
      instructions:
        [
          'Extract the latest current order from an Instagram conversation and the supplied catalogue.',
          'Messages are ordered from oldest to newest. The anchor is the final message and closes the order being recognized.',
          'Identify the latest purchase intent that leads to the anchor. Earlier completed orders are historical context and must not supply products for the current order.',
          'A newer explicitly named product replaces an older product unless the customer explicitly asks to add another item, repeat the previous order, or order both.',
          'Give the strongest weight to the most recent explicit product description and match it using all available details such as dimensions, model, brand, material, color, and size.',
          'Extract only facts explicitly supported by the current order context. Never invent missing values.',
          'catalogId must be one of the supplied product ids or null. Return missing field paths in missingFields.',
        ].join(' '),
      input: JSON.stringify({
        ...input,
        recognitionTarget: {
          anchorMessageId,
          messageOrder: 'oldest_to_newest',
          scope: 'latest_purchase_intent_before_anchor',
          newerProductPolicy: 'replace_older_unless_explicitly_added_or_repeated',
        },
      }),
      text: {
        format: {
          type: 'json_schema',
          name: 'instagram_order_extraction',
          strict: true,
          schema: orderJsonSchema,
        },
      },
    });

    try {
      return {
        order: recognizedOrderSchema.parse(JSON.parse(response.output_text)),
        metadata: {
          responseId: response.id,
          model: response.model,
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
        },
      };
    } catch {
      throw new Error('OpenAI returned an invalid order extraction');
    }
  }
}

export function createOpenAiOrderRecognizer(
  apiKey: string,
  model: string,
): OpenAiOrderRecognizer {
  const openai = new OpenAI({ apiKey });

  return new OpenAiOrderRecognizer(
    {
      responses: {
        create: async (input) => {
          const response = await openai.responses.create(input as never);
          return {
            id: response.id,
            model: String(response.model),
            output_text: response.output_text,
            ...(response.usage
              ? { usage: {
                  input_tokens: response.usage.input_tokens,
                  output_tokens: response.usage.output_tokens,
                } }
              : {}),
          };
        },
      },
    },
    model,
  );
}

function nullableFields(names: string[]): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: names,
    properties: Object.fromEntries(names.map((name) => [name, { type: ['string', 'null'] }])),
  };
}
