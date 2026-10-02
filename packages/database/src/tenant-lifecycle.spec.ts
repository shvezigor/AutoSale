import { describe, expect, it, vi } from 'vitest';

import {
  assertLifecycleTransition,
  assertTenantAcceptingMutations,
  TenantLifecycleFrozenError,
} from './tenant-lifecycle.js';

const tenantId = '11111111-1111-4111-8111-111111111111';

describe('tenant lifecycle state machine', () => {
  it('allows retrying a failed export', () => {
    expect(assertLifecycleTransition('FAILED', 'EXPORTING')).toBeUndefined();
  });

  it('refuses every destructive phase-one transition', () => {
    expect(() => assertLifecycleTransition('EXPORT_READY', 'DELETING')).toThrow('DESTRUCTIVE_PHASE_DISABLED');
  });

  it('rejects a business mutation while deletion preparation is frozen', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: '22222222-2222-4222-8222-222222222222' });
    const transaction = { $queryRaw: vi.fn().mockResolvedValue([{ available: true }]), tenantLifecycleRequest: { findFirst } };

    await expect(assertTenantAcceptingMutations(transaction as never, tenantId, 'ORDER_MUTATION'))
      .rejects.toBeInstanceOf(TenantLifecycleFrozenError);
    expect(findFirst).toHaveBeenCalledOnce();
  });

  it('allows a business mutation when no deletion request is frozen', async () => {
    const transaction = { $queryRaw: vi.fn().mockResolvedValue([{ available: true }]), tenantLifecycleRequest: { findFirst: vi.fn().mockResolvedValue(null) } };

    await expect(assertTenantAcceptingMutations(transaction as never, tenantId, 'CATALOGUE')).resolves.toBeUndefined();
  });

  it.each([
    'META_INBOUND', 'TELEGRAM_INBOUND', 'ORDER_RECOGNITION', 'CONVERSATION_REPLY',
    'ORDER_MUTATION', 'COMMERCIAL_TERMS', 'PAYMENT', 'PROCUREMENT', 'CATALOGUE',
    'DELIVERY', 'SUPPLIER_SEND', 'SHEETS_EXPORT', 'NOTIFICATION_SEND', 'ACCOUNT_ADMINISTRATION',
  ] as const)('returns the same safe conflict for %s', async (surface) => {
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ available: true }]),
      tenantLifecycleRequest: { findFirst: vi.fn().mockResolvedValue({ id: 'freeze-1' }) },
    };

    await expect(assertTenantAcceptingMutations(transaction as never, tenantId, surface))
      .rejects.toMatchObject({ message: 'TENANT_LIFECYCLE_FROZEN', surface });
  });
});
