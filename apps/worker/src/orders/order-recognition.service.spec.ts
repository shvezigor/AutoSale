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
});
