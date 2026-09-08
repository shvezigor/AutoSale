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

  it('marks the newest purchase intent as the recognition target when the chat contains an older order', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'resp_latest_order',
      model: 'gpt-5.4-mini',
      output_text: JSON.stringify({
        isOrder: true,
        customer: { name: 'Ігор', phone: '0976536783', instagramUsername: null },
        delivery: { city: 'Луцьк', address: null, novaPoshtaBranch: '22' },
        items: [{
          catalogId: 'DOOR-1200',
          originalText: '1200х2050 Стандарт VINARIT Вологостійка МДФ',
          quantity: 1,
          color: null,
          size: '1200х2050',
          confidence: 0.98,
        }],
        missingFields: [],
        overallConfidence: 0.96,
      }),
      usage: { input_tokens: 200, output_tokens: 90 },
    });
    const recognizer = new OpenAiOrderRecognizer({ responses: { create } }, 'gpt-5.4-mini');

    await recognizer.recognize({
      messages: [
        { id: 'old-product', direction: 'INBOUND', text: 'Хочу замовити штани ройал кет' },
        { id: 'old-confirmation', direction: 'OUTBOUND', text: 'Дякую, беремо замовлення в роботу' },
        { id: 'new-product', direction: 'INBOUND', text: 'Хочу двері 1200х2050 Стандарт VINARIT Вологостійка МДФ' },
        { id: 'trigger', direction: 'OUTBOUND', text: 'Замовлення прийнято' },
      ],
      products: [{ id: 'DOOR-1200', name: '1200х2050 Стандарт VINARIT Вологостійка МДФ', aliases: [] }],
    });

    const request = create.mock.calls[0]?.[0] as { input: string };
    expect(JSON.parse(request.input)).toMatchObject({
      recognitionTarget: {
        anchorMessageId: 'trigger',
        messageOrder: 'oldest_to_newest',
        scope: 'latest_purchase_intent_before_anchor',
        newerProductPolicy: 'replace_older_unless_explicitly_added_or_repeated',
      },
    });
  });
});
