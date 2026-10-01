import { withTenantTransaction, type PrismaClient } from '@autosale/database';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { CryptoService } from '../auth/crypto.service.js';
import type { EmailDelivery } from '../auth/email-delivery.js';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export class TeamService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly crypto: CryptoService,
    private readonly email: EmailDelivery,
    private readonly tokenPepper: string,
    private readonly publicUrl: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(tenantId: string) {
    const [members, invitations] = await withTenantTransaction(this.prisma, tenantId, (transaction) => Promise.all([
      transaction.tenantMembership.findMany({
        where: { tenantId }, orderBy: { createdAt: 'asc' },
        select: { id: true, role: true, status: true, createdAt: true, user: { select: { email: true, name: true } } },
      }),
      transaction.tenantInvitation.findMany({
        where: { tenantId, usedAt: null, revokedAt: null }, orderBy: { createdAt: 'desc' },
        select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
      }),
    ]));
    return {
      members: members.map((item) => ({ id: item.id, email: item.user.email, name: item.user.name, role: item.role, status: item.status, createdAt: item.createdAt.toISOString() })),
      invitations: invitations.map((item) => ({ id: item.id, email: item.email, role: item.role, expiresAt: item.expiresAt.toISOString(), createdAt: item.createdAt.toISOString() })),
    };
  }

  async invite(tenantId: string, invitedById: string, rawEmail: string) {
    const email = rawEmail.trim().toLowerCase();
    const result = await withTenantTransaction(this.prisma, tenantId, async (transaction) => {
      const existing = await transaction.tenantInvitation.findFirst({
        where: { tenantId, email, usedAt: null, revokedAt: null, expiresAt: { gt: this.now() } },
      });
      if (existing) return { invitation: existing, rawToken: null };
      const token = this.crypto.issueOpaqueToken(this.tokenPepper);
      const invitation = await transaction.tenantInvitation.create({
        data: { tenantId, invitedById, email, role: 'MANAGER', tokenHash: token.hash, expiresAt: new Date(this.now().getTime() + INVITATION_TTL_MS) },
      });
      return { invitation, rawToken: token.raw };
    });
    if (result.rawToken) await this.email.sendInvitation(email, `${this.publicUrl}/invite/${encodeURIComponent(result.rawToken)}`);
    return invitationView(result.invitation);
  }

  async blockMember(tenantId: string, membershipId: string): Promise<{ blocked: true }> {
    const userId = await withTenantTransaction(this.prisma, tenantId, async (transaction) => {
      const membership = await transaction.tenantMembership.findFirst({ where: { id: membershipId, tenantId, role: 'MANAGER' }, select: { userId: true } });
      if (!membership) throw new NotFoundException('Team member not found');
      await transaction.tenantMembership.updateMany({ where: { id: membershipId, tenantId, role: 'MANAGER' }, data: { status: 'BLOCKED' } });
      return membership.userId;
    });
    await this.prisma.$queryRaw`
      SELECT revoked_count FROM public.api_revoke_sessions(${userId}::uuid, NULL::uuid, ${tenantId}::uuid, ${this.now()})
    `;
    return { blocked: true };
  }

  async revokeInvitation(tenantId: string, invitationId: string): Promise<{ revoked: true }> {
    const result = await withTenantTransaction(this.prisma, tenantId, (transaction) => transaction.tenantInvitation.updateMany({
      where: { id: invitationId, tenantId, usedAt: null, revokedAt: null },
      data: { revokedAt: this.now() },
    }));
    if (result.count === 0) throw new NotFoundException('Invitation not found');
    return { revoked: true };
  }

  async accept(rawToken: string, input: { name: string; password: string }): Promise<{ accepted: true }> {
    const tokenHash = this.crypto.hashOpaqueToken(rawToken, this.tokenPepper);
    const now = this.now();
    const passwordHash = await this.crypto.hashPassword(input.password);
    const authority = await this.prisma.$queryRaw<Array<{ tenant_id: string; invitation_id: string }>>`
      SELECT tenant_id, invitation_id FROM public.api_invitation_authority(${tokenHash}, ${now})
    `;
    if (!authority[0]) throw new BadRequestException('Invalid or expired invitation');
    await withTenantTransaction(this.prisma, authority[0].tenant_id, async (tx) => {
      const invitation = await tx.tenantInvitation.findFirst({ where: { id: authority[0]!.invitation_id, tokenHash } });
      if (!invitation || invitation.usedAt || invitation.revokedAt || invitation.expiresAt <= now) {
        throw new BadRequestException('Invalid or expired invitation');
      }
      const claimed = await tx.tenantInvitation.updateMany({
        where: { id: invitation.id, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) throw new BadRequestException('Invalid or expired invitation');
      const existing = await tx.user.findUnique({ where: { email: invitation.email } });
      const user = existing ?? await tx.user.create({
        data: { email: invitation.email, name: input.name.trim(), passwordHash, status: 'ACTIVE', emailVerifiedAt: now },
      });
      if (existing?.status === 'BLOCKED') throw new BadRequestException('Invitation cannot be accepted');
      await tx.tenantMembership.upsert({
        where: { userId_tenantId: { userId: user.id, tenantId: invitation.tenantId } },
        create: { userId: user.id, tenantId: invitation.tenantId, role: 'MANAGER', status: 'ACTIVE' },
        update: { role: 'MANAGER', status: 'ACTIVE' },
      });
    });
    return { accepted: true };
  }
}

function invitationView(invitation: { id: string; email: string; role: string; expiresAt: Date }) {
  return { id: invitation.id, email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt.toISOString() };
}
