import { describe, expect, it } from 'vitest';

import { decideOrderStatus } from './approval-policy.js';

describe('decideOrderStatus', () => {
  it('requires review when approval is always enabled', () => {
    expect(decideOrderStatus({ mode: 'ALWAYS', confidence: 0.99, isComplete: true })).toBe(
      'NEEDS_REVIEW',
    );
  });

  it('auto approves a complete order when approval is disabled', () => {
    expect(decideOrderStatus({ mode: 'NEVER', confidence: 0.75, isComplete: true })).toBe(
      'AUTO_APPROVED',
    );
  });

  it('requires review for incomplete data even when approval is disabled', () => {
    expect(decideOrderStatus({ mode: 'NEVER', confidence: 0.99, isComplete: false })).toBe(
      'NEEDS_REVIEW',
    );
  });

  it('uses the configured threshold in low-confidence mode', () => {
    expect(
      decideOrderStatus({
        mode: 'ON_LOW_CONFIDENCE',
        confidence: 0.89,
        threshold: 0.9,
        isComplete: true,
      }),
    ).toBe('NEEDS_REVIEW');
    expect(
      decideOrderStatus({
        mode: 'ON_LOW_CONFIDENCE',
        confidence: 0.9,
        threshold: 0.9,
        isComplete: true,
      }),
    ).toBe('AUTO_APPROVED');
  });
});
