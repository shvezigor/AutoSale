export type RetentionCategory =
  | 'RAW_WEBHOOKS'
  | 'USER_NOTIFICATIONS'
  | 'SECURITY_AUDIT'
  | 'CONVERSATIONS_AND_CUSTOMER_DATA'
  | 'ORDERS_PAYMENTS_AND_DELIVERY';

export type RetentionPolicy =
  | { category: RetentionCategory; status: 'DRY_RUN_ONLY'; days: number }
  | { category: RetentionCategory; status: 'POLICY_NOT_CONFIGURED'; days: null };

export const RETENTION_POLICIES: readonly RetentionPolicy[] = [
  { category: 'RAW_WEBHOOKS', days: 30, status: 'DRY_RUN_ONLY' },
  { category: 'USER_NOTIFICATIONS', days: 90, status: 'DRY_RUN_ONLY' },
  { category: 'SECURITY_AUDIT', days: 365, status: 'DRY_RUN_ONLY' },
  { category: 'CONVERSATIONS_AND_CUSTOMER_DATA', days: null, status: 'POLICY_NOT_CONFIGURED' },
  { category: 'ORDERS_PAYMENTS_AND_DELIVERY', days: null, status: 'POLICY_NOT_CONFIGURED' },
] as const;

export function retentionCutoff(policy: RetentionPolicy, now: Date): Date | null {
  if (policy.status === 'POLICY_NOT_CONFIGURED') return null;
  return new Date(now.getTime() - policy.days * 24 * 60 * 60_000);
}
