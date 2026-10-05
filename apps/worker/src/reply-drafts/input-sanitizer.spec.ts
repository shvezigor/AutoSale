import { describe, expect, it } from 'vitest';
import { buildSafeReplyInput } from './input-sanitizer.js';

describe('buildSafeReplyInput', () => {
  it('removes unrelated contact, address and payment identifiers', () => {
    const safe = buildSafeReplyInput(
      'Is DOOR-7 available? Call +380671234567, ship to вул. Вигадана 22, IBAN UA123456789012345678901234567.',
      ['My email is fictional@example.invalid'],
    );
    expect(safe.latestInbound).toContain('DOOR-7');
    expect(JSON.stringify(safe)).not.toMatch(/380671234567|Вигадана|UA123456789012345678901234567|fictional@example/);
  });

  it('bounds customer text and context', () => {
    const safe = buildSafeReplyInput('a'.repeat(3000), Array.from({ length: 12 }, () => 'b'.repeat(3000)));
    expect(safe.latestInbound.length).toBeLessThanOrEqual(600);
    expect(safe.recentContext).toHaveLength(3);
    expect(safe.recentContext.every((line) => line.length <= 300)).toBe(true);
  });
});
