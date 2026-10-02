import type { TenantLifecycleStatus, TenantMutationSurface } from '@autosale/contracts';

import type { Prisma } from './generated/prisma/client.js';

const transitions: ReadonlyMap<TenantLifecycleStatus, ReadonlySet<TenantLifecycleStatus>> = new Map([
  ['REQUESTED', new Set<TenantLifecycleStatus>(['EXPORTING', 'CANCELLED'])],
  ['EXPORTING', new Set<TenantLifecycleStatus>(['EXPORT_READY', 'FAILED'])],
  ['FAILED', new Set<TenantLifecycleStatus>(['EXPORTING', 'CANCELLED'])],
  ['EXPORT_READY', new Set<TenantLifecycleStatus>(['CANCELLED'])],
  ['CANCELLED', new Set<TenantLifecycleStatus>()],
]);

export class TenantLifecycleFrozenError extends Error {
  readonly code = 'TENANT_LIFECYCLE_FROZEN';

  constructor(readonly surface: TenantMutationSurface) {
    super('TENANT_LIFECYCLE_FROZEN');
    this.name = 'TenantLifecycleFrozenError';
  }
}

export function assertLifecycleTransition(from: TenantLifecycleStatus, to: TenantLifecycleStatus | 'DELETING'): void {
  if (to === 'DELETING') throw new Error('DESTRUCTIVE_PHASE_DISABLED');
  if (!transitions.get(from)?.has(to)) throw new Error('INVALID_TENANT_LIFECYCLE_TRANSITION');
}

export async function assertTenantAcceptingMutations(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  surface: TenantMutationSurface,
): Promise<void> {
  const frozen = await transaction.tenantLifecycleRequest.findFirst({
    where: {
      tenantId,
      kind: 'DELETE',
      ingestionFrozenAt: { not: null },
      status: { in: ['REQUESTED', 'EXPORTING', 'EXPORT_READY', 'FAILED'] },
    },
    select: { id: true },
  });

  if (frozen) throw new TenantLifecycleFrozenError(surface);
}
