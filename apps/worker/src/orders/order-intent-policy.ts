export type IntentDetectionMode = 'PHRASE_ONLY' | 'AI_SUGGESTION' | 'AI_AUTOMATION';

export type ConversationalIntentDecision =
  | { action: 'IGNORE'; reason: 'PHRASE_ONLY' | 'NO_EXPLICIT_PURCHASE_INTENT' | 'NO_USABLE_PRODUCT' }
  | { action: 'SUGGEST'; reason: 'MANAGER_REVIEW_MODE' | 'INCOMPLETE_ORDER' | 'LOW_CONFIDENCE' }
  | { action: 'AUTO_CREATE'; reason: 'COMPLETE_HIGH_CONFIDENCE' };

export function decideConversationalIntent(input: {
  mode: IntentDetectionMode;
  isOrder: boolean;
  anchorHasExplicitPurchaseIntent: boolean;
  hasUsableProduct: boolean;
  isComplete: boolean;
  confidence: number;
  threshold: number;
}): ConversationalIntentDecision {
  if (input.mode === 'PHRASE_ONLY') return { action: 'IGNORE', reason: 'PHRASE_ONLY' };
  if (!input.isOrder || !input.anchorHasExplicitPurchaseIntent) {
    return { action: 'IGNORE', reason: 'NO_EXPLICIT_PURCHASE_INTENT' };
  }
  if (!input.hasUsableProduct) return { action: 'IGNORE', reason: 'NO_USABLE_PRODUCT' };
  if (input.mode === 'AI_SUGGESTION') return { action: 'SUGGEST', reason: 'MANAGER_REVIEW_MODE' };
  if (!input.isComplete) return { action: 'SUGGEST', reason: 'INCOMPLETE_ORDER' };
  if (input.confidence < input.threshold) return { action: 'SUGGEST', reason: 'LOW_CONFIDENCE' };
  return { action: 'AUTO_CREATE', reason: 'COMPLETE_HIGH_CONFIDENCE' };
}
