import type { PrismaClient } from '@autosale/database';
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
    const [members, invitations] = await Promise.all([
      this.prisma.tenantMembership.findMany({
        where: { tenantId }, orderBy: { createdAt: 'asc' },
        select: { id: true, role: true, status: true, createdAt: true, user: { select: { email: true, name: true } } },
      }),
      this.prisma.tenantInvitation.findMany({
        where: { tenantId, usedAt: null, revokedAt: null }, orderBy: { createdAt: 'desc' },
        select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
      }),
    ]);
    return {
      members: members.map((item) => ({ id: item.id, email: item.user.email, name: item.user.name, role: item.role, status: item.status, createdAt: item.createdAt.toISOString() })),
      invitations: invitations.map((item) => ({ id: item.id, email: item.email, role: item.role, expiresAt: item.expiresAt.toISOString(), createdAt: item.createdAt.toISOString() })),
    };
  }

  async invite(tenantId: string, invitedById: string, rawEmail: string) {
    const email = rawEmail.trim().toLowerCase();
    const existing = await this.prisma.tenantInvitation.findFirst({
      where: { tenantId, email, usedAt: null, revokedAt: null, expiresAt: { gt: this.now() } },
    });
    if (existing) return invitationView(existing);
    const token = this.crypto.issueOpaqueToken(this.tokenPepper);
    const invitation = await this.prisma.tenantInvitation.create({
      data: { tenantId, invitedById, email, role: 'MANAGER', tokenHash: token.hash, expiresAt: new Date(this.now().getTime() + INVITATION_TTL_MS) },
    });
    await this.email.sendInvitation(email, `${this.publicUrl}/invite/${encodeURIComponent(token.raw)}`);
    return invitationView(invitation);
  }

  async blockMember(tenantId: string, membershipId: string): Promise<{ blocked: true }> {
    const membership = await this.prisma.tenantMembership.findFirst({ where: { id: membershipId, tenantId, role: 'MANAGER' }, select: { userId: true } });
    if (!membership) throw new NotFoundException('Team member not found');
    await this.prisma.tenantMembership.updateMany({ where: { id: membershipId, tenantId, role: 'MANAGER' }, data: { status: 'BLOCKED' } });
    await this.prisma.session.updateMany({ where: { tenantId, userId: membership.userId, revokedAt: null }, data: { revokedAt: this.now() } });
    return { blocked: true };
  }

  async revokeInvitation(tenantId: string, invitationId: string): Promise<{ revoked: true }> {
    const result = await this.prisma.tenantInvitation.updateMany({
      where: { id: invitationId, tenantId, usedAt: null, revokedAt: null },
      data: { revokedAt: this.now() },
    });
    if (result.count === 0) throw new NotFoundException('Invitation not found');
    return { revoked: true };
  }

  async accept(rawToken: string, input: { name: string; password: string }): Promise<{ accepted: true }> {
    const tokenHash = this.crypto.hashOpaqueToken(rawToken, this.tokenPepper);
    const now = this.now();
    const passwordHash = await this.crypto.hashPassword(input.password);
    await this.prisma.$transaction(async (tx) => {
      const invitation = await tx.tenantInvitation.findUnique({ where: { tokenHash } });
      if (!invitation || invitation.usedAt || invitation.revokedAt || invitation.expiresAt <= now) {
        throw new BadRequestException('Invalid or expired invitation');
      }
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
      await tx.tenantInvitation.update({ where: { id: invitation.id }, data: { usedAt: now } });
    });
    return { accepted: true };
  }
}

function invitationView(invitation: { id: string; email: string; role: string; expiresAt: Date }) {
  return { id: invitation.id, email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt.toISOString() };
}
