import { describe, expect, it } from 'vitest';
import {
  createReplyDraftSchema,
  replyDraftSummarySchema,
  replyDraftSourceSchema,
  replyStylePatchSchema,
  replyStyleSchema,
} from './reply-drafts.js';
import { outboundMessageInputSchema } from './conversations.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const draftId = '22222222-2222-4222-8222-222222222222';

describe('reply draft contracts', () => {
  it('keeps the tenant feature disabled until configured', () => {
    const defaults = replyStyleSchema.parse({
      tenantId,
      enabled: false,
      companyName: '',
      tone: 'NEUTRAL',
      addressForm: 'FORMAL_YOU',
      guidance: '',
    });
    expect(defaults.enabled).toBe(false);
    expect(replyStylePatchSchema.safeParse({ enabled: true, companyName: '  ' }).success).toBe(false);
    expect(replyStylePatchSchema.safeParse({ guidance: 'x'.repeat(501) }).success).toBe(false);
  });

  it('accepts only an idempotency UUID for generation', () => {
    expect(createReplyDraftSchema.safeParse({ idempotencyKey: draftId }).success).toBe(true);
    expect(createReplyDraftSchema.safeParse({ idempotencyKey: draftId, text: 'override' }).success).toBe(false);
  });

  it('exposes bounded catalogue facts without product descriptions', () => {
    const source = replyDraftSourceSchema.parse({
      productId: draftId,
      sku: 'SKU-1',
      name: 'Fictional door',
      variants: { size: '90x200' },
      price: '1500',
      currency: 'UAH',
      stockQuantity: 0,
      updatedAt: '2026-10-05T10:00:00.000Z',
      description: 'never exported',
    });
    expect(source).not.toHaveProperty('description');
    expect(source.stockQuantity).toBe(0);
  });

  it('keeps manual send valid and accepts an optional reviewed draft identity', () => {
    expect(outboundMessageInputSchema.safeParse({ text: 'Hello', idempotencyKey: draftId }).success).toBe(true);
    expect(outboundMessageInputSchema.safeParse({ text: 'Hello', idempotencyKey: draftId, draftId }).success).toBe(true);
  });

  it('exposes safe automatic scheduling metadata', () => {
    const automatic = {
      id: draftId,
      conversationId: '33333333-3333-4333-8333-333333333333',
      anchorMessageId: '44444444-4444-4444-8444-444444444444',
      status: 'QUEUED',
      outcome: null,
      generatedText: null,
      finalText: null,
      sources: [],
      errorCode: null,
      triggerSource: 'AUTOMATIC',
      availableAt: '2026-10-05T14:00:10.000Z',
      createdAt: '2026-10-05T14:00:00.000Z',
      updatedAt: '2026-10-05T14:00:00.000Z',
    };

    expect(replyDraftSummarySchema.parse(automatic).triggerSource).toBe('AUTOMATIC');
    expect(replyDraftSummarySchema.safeParse({ ...automatic, triggerSource: 'ROBOT' }).success).toBe(false);
  });
});
