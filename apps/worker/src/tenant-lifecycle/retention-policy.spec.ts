import { describe, expect, it } from 'vitest';

import { RETENTION_POLICIES, retentionCutoff } from './retention-policy.js';

describe('retention policy', () => {
  it('defines only dry-run cutoffs for the approved launch categories', () => {
    const now = new Date('2026-10-02T12:00:00.000Z');
    const raw = RETENTION_POLICIES.find((policy) => policy.category === 'RAW_WEBHOOKS')!;
    const notifications = RETENTION_POLICIES.find((policy) => policy.category === 'USER_NOTIFICATIONS')!;
    const audit = RETENTION_POLICIES.find((policy) => policy.category === 'SECURITY_AUDIT')!;

    expect(retentionCutoff(raw, now)).toEqual(new Date('2026-09-02T12:00:00.000Z'));
    expect(retentionCutoff(notifications, now)).toEqual(new Date('2026-07-04T12:00:00.000Z'));
    expect(retentionCutoff(audit, now)).toEqual(new Date('2025-10-02T12:00:00.000Z'));
  });

  it('does not invent a cutoff for merchant-specific business records', () => {
    const unconfigured = RETENTION_POLICIES.filter((policy) => policy.status === 'POLICY_NOT_CONFIGURED');
    expect(unconfigured.map((policy) => policy.category)).toEqual([
      'CONVERSATIONS_AND_CUSTOMER_DATA', 'ORDERS_PAYMENTS_AND_DELIVERY',
    ]);
    expect(unconfigured.every((policy) => retentionCutoff(policy, new Date()) === null)).toBe(true);
  });
});
