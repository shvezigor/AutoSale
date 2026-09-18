import { describe, expect, it } from 'vitest';

import { decideConversationalIntent } from './order-intent-policy.js';

describe('decideConversationalIntent', () => {
  it('does not run conversational detection in phrase-only mode', () => {
    expect(decideConversationalIntent({
      mode: 'PHRASE_ONLY',
      isOrder: true,
      hasUsableProduct: true,
      isComplete: true,
      confidence: 0.99,
      threshold: 0.9,
    })).toEqual({ action: 'IGNORE', reason: 'PHRASE_ONLY' });
  });

  it('ignores conversation revisions without explicit purchase intent', () => {
    expect(decideConversationalIntent({
      mode: 'AI_AUTOMATION',
      isOrder: false,
      hasUsableProduct: true,
      isComplete: true,
      confidence: 0.99,
      threshold: 0.9,
    })).toEqual({ action: 'IGNORE', reason: 'NO_EXPLICIT_PURCHASE_INTENT' });
  });

  it('ignores apparent intent without a usable product description', () => {
    expect(decideConversationalIntent({
      mode: 'AI_SUGGESTION',
      isOrder: true,
      hasUsableProduct: false,
      isComplete: false,
      confidence: 0.7,
      threshold: 0.9,
    })).toEqual({ action: 'IGNORE', reason: 'NO_USABLE_PRODUCT' });
  });

  it('always routes an eligible AI suggestion to manager review', () => {
    expect(decideConversationalIntent({
      mode: 'AI_SUGGESTION',
      isOrder: true,
      hasUsableProduct: true,
      isComplete: true,
      confidence: 0.99,
      threshold: 0.9,
    })).toEqual({ action: 'SUGGEST', reason: 'MANAGER_REVIEW_MODE' });
  });

  it('automates only a complete high-confidence agreement', () => {
    expect(decideConversationalIntent({
      mode: 'AI_AUTOMATION',
      isOrder: true,
      hasUsableProduct: true,
      isComplete: true,
      confidence: 0.94,
      threshold: 0.9,
    })).toEqual({ action: 'AUTO_CREATE', reason: 'COMPLETE_HIGH_CONFIDENCE' });
  });

  it('routes incomplete or uncertain agreements to manager review', () => {
    expect(decideConversationalIntent({
      mode: 'AI_AUTOMATION',
      isOrder: true,
      hasUsableProduct: true,
      isComplete: false,
      confidence: 0.94,
      threshold: 0.9,
    })).toEqual({ action: 'SUGGEST', reason: 'INCOMPLETE_ORDER' });

    expect(decideConversationalIntent({
      mode: 'AI_AUTOMATION',
      isOrder: true,
      hasUsableProduct: true,
      isComplete: true,
      confidence: 0.89,
      threshold: 0.9,
    })).toEqual({ action: 'SUGGEST', reason: 'LOW_CONFIDENCE' });
  });
});
