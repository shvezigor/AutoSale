import { describe, expect, it, vi } from 'vitest';

import { OrderRecognitionService } from './order-recognition.service.js';

const completeOrder = {
  isOrder: true,
  customer: { name: 'Іван', phone: '+380501112233', instagramUsername: 'ivan' },
  delivery: { city: 'Львів', address: null, novaPoshtaBranch: '12' },
  items: [
    {
      catalogId: 'SKU-1',
      originalText: 'Костюм',
      quantity: 1,
      color: null,
      size: 'M',
      confidence: 0.95,
    },
  ],
  missingFields: [],
  overallConfidence: 0.94,
};

describe('OrderRecognitionService', () => {
  it('auto approves a complete extraction when approval is disabled', async () => {
    const recognize = vi.fn().mockResolvedValue({ order: completeOrder, metadata: {} });
    const service = new OrderRecognitionService({ recognize });

    const result = await service.recognize(
      { messages: [], products: [{ id: 'SKU-1', name: 'Костюм', aliases: [] }] },
      { approvalMode: 'NEVER', autoApprovalThreshold: 0.9 },
    );

    expect(result.status).toBe('AUTO_APPROVED');
  });

  it('requires review when the model selects a product outside the supplied catalogue', async () => {
    const recognize = vi.fn().mockResolvedValue({
      order: { ...completeOrder, items: [{ ...completeOrder.items[0], catalogId: 'FAKE-SKU' }] },
      metadata: {},
    });
    const service = new OrderRecognitionService({ recognize });

    const result = await service.recognize(
      { messages: [], products: [{ id: 'SKU-1', name: 'Костюм', aliases: [] }] },
      { approvalMode: 'NEVER', autoApprovalThreshold: 0.9 },
    );

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.validationIssues).toContain('items.0.catalogId');
  });

  it('derives required fields from extracted data instead of trusting contradictory model paths', async () => {
    const recognize = vi.fn().mockResolvedValue({
      order: {
        ...completeOrder,
        missingFields: ['customer.instagramUsername', 'delivery.address', 'items[0].catalogId'],
      },
      metadata: {},
    });
    const service = new OrderRecognitionService({ recognize });

    const result = await service.recognize(
      { messages: [], products: [{ id: 'SKU-1', name: 'Костюм', aliases: [] }] },
      { approvalMode: 'NEVER', autoApprovalThreshold: 0.9 },
    );

    expect(result.validationIssues).toEqual([]);
    expect(result.status).toBe('AUTO_APPROVED');
  });

  it('fills only an unambiguous normalized catalogue match omitted by the model', async () => {
    const recognize = vi.fn().mockResolvedValue({
      order: {
        ...completeOrder,
        items: [{
          ...completeOrder.items[0],
          catalogId: null,
          originalText: 'двері 860х2050 Колізей (VINARIT) Вологостійка МДФ',
          size: '860х2050',
          confidence: 0.99,
        }],
      },
      metadata: {},
    });
    const service = new OrderRecognitionService({ recognize });

    const unique = await service.recognize(
      {
        messages: [],
        products: [
          { id: 'AUTO-5E44CA0A3C32', name: '860х2050      Колізей (VINARIT) Вологостійка МДФ', aliases: [] },
          { id: 'AUTO-E179854373E0', name: '860х2050 Колізей (плівка мат)', aliases: [] },
        ],
      },
      { approvalMode: 'NEVER', autoApprovalThreshold: 0.9 },
    );
    const ambiguous = await service.recognize(
      {
        messages: [],
        products: [
          { id: 'DOOR-860', name: 'Колізей', aliases: [] },
          { id: 'DOOR-960', name: 'Колізей', aliases: [] },
        ],
      },
      { approvalMode: 'NEVER', autoApprovalThreshold: 0.9 },
    );

    expect(unique.order.items[0]?.catalogId).toBe('AUTO-5E44CA0A3C32');
    expect(unique.validationIssues).not.toContain('items.0.catalogId');
    expect(ambiguous.order.items[0]?.catalogId).toBeNull();
    expect(ambiguous.validationIssues).toContain('items.0.catalogId');
  });
});
