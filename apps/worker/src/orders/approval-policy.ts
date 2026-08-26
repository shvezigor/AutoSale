export type ApprovalMode = 'ALWAYS' | 'NEVER' | 'ON_LOW_CONFIDENCE';
export type RecognizedOrderStatus = 'NEEDS_REVIEW' | 'AUTO_APPROVED';

export function decideOrderStatus(input: {
  mode: ApprovalMode;
  confidence: number;
  isComplete: boolean;
  threshold?: number;
}): RecognizedOrderStatus {
  if (!input.isComplete || input.mode === 'ALWAYS') return 'NEEDS_REVIEW';
  if (input.mode === 'NEVER') return 'AUTO_APPROVED';

  return input.confidence >= (input.threshold ?? 0.9) ? 'AUTO_APPROVED' : 'NEEDS_REVIEW';
}
