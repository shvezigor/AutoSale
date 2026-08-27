import { describe, expect, it, vi } from 'vitest';

import { OpenAiOrderRecognizer } from './openai-order-recognizer.js';

describe('OpenAiOrderRecognizer', () => {
  it('requests strict structured output and validates the result', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'resp_123',
      model: 'gpt-5.4-mini',
      output_text: JSON.stringify({
        isOrder: true,
        customer: { name: 'Іван', phone: '+380501112233', instagramUsername: 'ivan' },
        delivery: { city: 'Львів', address: null, novaPoshtaBranch: '12' },
        items: [
          {
            catalogId: 'SKU-1042',
            originalText: 'чорний костюм',
            quantity: 1,
            color: 'чорний',
            size: 'M',
            confidence: 0.94,
          },
        ],
        missingFields: [],
        overallConfidence: 0.93,
      }),
      usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 },
    });
    const recognizer = new OpenAiOrderRecognizer({ responses: { create } }, 'gpt-5.4-mini');

    const result = await recognizer.recognize({
      messages: [{ id: 'msg-1', direction: 'INBOUND', text: 'Хочу чорний костюм M' }],
      products: [{ id: 'SKU-1042', name: 'Костюм Classic', aliases: ['чорний костюм'] }],
    });

    expect(result.order.items[0]?.catalogId).toBe('SKU-1042');
    expect(result.metadata).toEqual({
      responseId: 'resp_123',
      model: 'gpt-5.4-mini',
      inputTokens: 120,
      outputTokens: 80,
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5.4-mini',
        store: false,
        text: {
          format: expect.objectContaining({ type: 'json_schema', strict: true }),
        },
      }),
    );
  });

  it('rejects a structurally invalid model response', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'resp_invalid',
      model: 'gpt-5.4-mini',
      output_text: '{"isOrder":true,"items":[]}',
    });
    const recognizer = new OpenAiOrderRecognizer({ responses: { create } }, 'gpt-5.4-mini');

    await expect(recognizer.recognize({ messages: [], products: [] })).rejects.toThrow(
      'OpenAI returned an invalid order extraction',
    );
  });
});
