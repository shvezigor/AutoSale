import { describe, expect, it, vi } from 'vitest';

import { TeamService } from './team.service.js';

vi.mock('@autosale/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@autosale/database')>()),
  withTenantTransaction: async <T>(prisma: unknown, _tenantId: string, operation: (transaction: unknown) => Promise<T>) => operation(prisma),
}));

describe('TeamService', () => {
  it('lists only members and invitations from the supplied tenant', async () => {
    const membershipFindMany = vi.fn().mockResolvedValue([]);
    const invitationFindMany = vi.fn().mockResolvedValue([]);
    const service = new TeamService({ tenantMembership: { findMany: membershipFindMany }, tenantInvitation: { findMany: invitationFindMany } } as never, {} as never, {} as never, 'pepper', 'https://app.example.com');

    await service.list('tenant-b');

    expect(membershipFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant-b' } }));
    expect(invitationFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant-b', usedAt: null, revokedAt: null } }));
  });

  it('creates a hashed manager invitation scoped to the owner tenant', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'invite-1', email: 'manager@example.com', role: 'MANAGER', expiresAt: new Date('2026-08-28T00:00:00Z') });
    const prisma = { tenantInvitation: { findFirst: vi.fn().mockResolvedValue(null), create } };
    const crypto = { issueOpaqueToken: () => ({ raw: 'raw-secret', hash: 'hashed-secret' }) };
    const email = { sendInvitation: vi.fn(async () => undefined) };
    const service = new TeamService(prisma as never, crypto as never, email as never, 'pepper', 'https://app.example.com', () => new Date('2026-08-27T00:00:00Z'));

    const result = await service.invite('tenant-1', 'owner-1', ' Manager@Example.com ');

    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: 'tenant-1', invitedById: 'owner-1', email: 'manager@example.com', tokenHash: 'hashed-secret', role: 'MANAGER' }) });
    expect(email.sendInvitation).toHaveBeenCalledWith('manager@example.com', 'https://app.example.com/invite/raw-secret');
    expect(JSON.stringify(result)).not.toContain('hashed-secret');
  });

  it('does not create or email an invitation while tenant administration is frozen', async () => {
    const create = vi.fn();
    const sendInvitation = vi.fn();
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ available: true }]),
      tenantLifecycleRequest: { findFirst: vi.fn().mockResolvedValue({ id: 'freeze-1' }) },
      tenantInvitation: { findFirst: vi.fn(), create },
    };
    const service = new TeamService(prisma as never, {} as never, { sendInvitation } as never, 'pepper', 'https://app.example.com');

    await expect(service.invite('tenant-1', 'owner-1', 'manager@example.com'))
      .rejects.toThrow('TENANT_LIFECYCLE_FROZEN');
    expect(create).not.toHaveBeenCalled();
    expect(sendInvitation).not.toHaveBeenCalled();
  });

  it('blocks only a member of the supplied tenant and revokes that tenant sessions', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const revokeSessions = vi.fn().mockResolvedValue([{ revoked_count: 2 }]);
    const prisma = { tenantMembership: { findFirst: vi.fn().mockResolvedValue({ id: 'member-1', userId: 'user-1' }), updateMany }, $queryRaw: revokeSessions };
    const service = new TeamService(prisma as never, {} as never, {} as never, 'pepper', 'https://app.example.com');

    await service.blockMember('tenant-b', 'member-1');

    expect(updateMany).toHaveBeenCalledWith({ where: { id: 'member-1', tenantId: 'tenant-b', role: 'MANAGER' }, data: { status: 'BLOCKED' } });
    expect(revokeSessions).toHaveBeenCalledOnce();
  });

  it('accepts a valid invitation once and creates an active manager', async () => {
    const invitation = { id: 'invite-1', tenantId: 'tenant-1', email: 'manager@example.com', role: 'MANAGER', usedAt: null, revokedAt: null, expiresAt: new Date('2026-08-28T00:00:00Z') };
    const userCreate = vi.fn().mockResolvedValue({ id: 'user-1' });
    const membershipUpsert = vi.fn();
    const invitationUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      tenantInvitation: { findFirst: vi.fn().mockResolvedValue(invitation), updateMany: invitationUpdate },
      user: { findUnique: vi.fn().mockResolvedValue(null), create: userCreate },
      tenantMembership: { upsert: membershipUpsert },
    };
    const prisma = { ...tx, $queryRaw: vi.fn().mockResolvedValue([{ tenant_id: 'tenant-1', invitation_id: 'invite-1' }]) };
    const crypto = { hashOpaqueToken: () => 'token-hash', hashPassword: vi.fn().mockResolvedValue('password-hash') };
    const service = new TeamService(prisma as never, crypto as never, {} as never, 'pepper', 'https://app.example.com', () => new Date('2026-08-27T00:00:00Z'));

    await expect(service.accept('raw-token', { name: 'Manager', password: 'long secure password' })).resolves.toEqual({ accepted: true });
    expect(userCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ email: 'manager@example.com', passwordHash: 'password-hash', status: 'ACTIVE' }) });
    expect(membershipUpsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ tenantId: 'tenant-1', role: 'MANAGER', status: 'ACTIVE' }) }));
    expect(invitationUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { usedAt: new Date('2026-08-27T00:00:00Z') } }));
  });

  it('revokes only an unused invitation from the supplied tenant', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const service = new TeamService({ tenantInvitation: { updateMany } } as never, {} as never, {} as never, 'pepper', 'https://app.example.com');

    await expect(service.revokeInvitation('tenant-b', 'invite-1')).resolves.toEqual({ revoked: true });
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 'invite-1', tenantId: 'tenant-b', usedAt: null, revokedAt: null }, data: { revokedAt: expect.any(Date) } });
  });
});
