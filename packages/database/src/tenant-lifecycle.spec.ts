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
    const transaction = { tenantLifecycleRequest: { findFirst } };

    await expect(assertTenantAcceptingMutations(transaction as never, tenantId, 'ORDER_MUTATION'))
      .rejects.toBeInstanceOf(TenantLifecycleFrozenError);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        tenantId,
        kind: 'DELETE',
        ingestionFrozenAt: { not: null },
        status: { in: ['REQUESTED', 'EXPORTING', 'EXPORT_READY', 'FAILED'] },
      },
      select: { id: true },
    });
  });

  it('allows a business mutation when no deletion request is frozen', async () => {
    const transaction = { tenantLifecycleRequest: { findFirst: vi.fn().mockResolvedValue(null) } };

    await expect(assertTenantAcceptingMutations(transaction as never, tenantId, 'CATALOGUE')).resolves.toBeUndefined();
  });
});
