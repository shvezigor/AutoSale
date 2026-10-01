import type { PrismaClient } from '@autosale/database';

export async function activeMembershipForUser(
  prisma: Pick<PrismaClient, '$queryRaw'>,
  userId: string,
): Promise<{ tenantId: string; role: 'OWNER' | 'MANAGER' } | null> {
  const rows = await prisma.$queryRaw<Array<{ tenant_id: string; membership_role: 'OWNER' | 'MANAGER' }>>`
    SELECT tenant_id, membership_role
    FROM public.api_active_membership_for_user(${userId}::uuid)
  `;
  const membership = rows[0];
  return membership ? { tenantId: membership.tenant_id, role: membership.membership_role } : null;
}

export async function activateOwnerMemberships(
  prisma: Pick<PrismaClient, '$queryRaw'>,
  userId: string,
): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ activated_count: number }>>`
    SELECT activated_count FROM public.api_activate_owner_memberships(${userId}::uuid)
  `;
  return rows[0]?.activated_count ?? 0;
}
