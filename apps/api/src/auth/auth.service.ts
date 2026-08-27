import type { LoginRequest, PublicSession, RegisterRequest } from '@autosale/contracts/auth';
import type { PrismaClient } from '@autosale/database';
import { BadRequestException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

import type { SessionMetadata } from './auth.types.js';
import { CryptoService } from './crypto.service.js';
import type { EmailDelivery } from './email-delivery.js';
import { SessionService } from './session.service.js';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1_000;

export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly crypto: CryptoService,
    private readonly sessions: SessionService,
    private readonly email: EmailDelivery,
    private readonly tokenPepper: string,
    private readonly publicUrl: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async register(input: RegisterRequest, _metadata: SessionMetadata): Promise<{ accepted: true }> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const passwordHash = await this.crypto.hashPassword(input.password);
    const token = this.crypto.issueOpaqueToken(this.tokenPepper);
    const expiresAt = new Date(this.now().getTime() + TOKEN_TTL_MS);
    try {
      await this.prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: { key: `${slug(input.tenantName)}-${token.raw.slice(0, 8).toLowerCase()}`, name: input.tenantName.trim() },
        });
        const user = await tx.user.create({
          data: { email: normalizedEmail, name: input.name.trim(), passwordHash, status: 'PENDING' },
        });
        await tx.tenantMembership.create({
          data: { userId: user.id, tenantId: tenant.id, role: 'OWNER', status: 'PENDING' },
        });
        await tx.emailVerificationToken.create({
          data: { userId: user.id, tokenHash: token.hash, expiresAt },
        });
        await this.email.sendVerification(normalizedEmail, `${this.publicUrl}/verify-email?token=${encodeURIComponent(token.raw)}`);
      });
      return { accepted: true };
    } catch (error) {
      if (error instanceof Error && error.message === 'Email delivery is not configured') {
        throw new ServiceUnavailableException('Email delivery is not configured');
      }
      throw error;
    }
  }

  async verifyEmail(rawToken: string): Promise<{ verified: true }> {
    const tokenHash = this.crypto.hashOpaqueToken(rawToken, this.tokenPepper);
    const now = this.now();
    await this.prisma.$transaction(async (tx) => {
      const token = await tx.emailVerificationToken.findUnique({ where: { tokenHash } });
      if (!token || token.usedAt || token.expiresAt <= now) throw new BadRequestException('Invalid or expired token');
      await tx.user.update({ where: { id: token.userId }, data: { status: 'ACTIVE', emailVerifiedAt: now } });
      await tx.tenantMembership.updateMany({ where: { userId: token.userId, role: 'OWNER' }, data: { status: 'ACTIVE' } });
      await tx.emailVerificationToken.update({ where: { id: token.id }, data: { usedAt: now } });
    });
    return { verified: true };
  }

  async login(input: LoginRequest, metadata: SessionMetadata): Promise<{ session: PublicSession; rawToken: string; expiresAt: Date }> {
    const email = input.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email }, include: { memberships: true } });
    const valid = user ? await this.crypto.verifyPassword(user.passwordHash, input.password) : false;
    if (!user || !valid || user.status !== 'ACTIVE' || !user.emailVerifiedAt) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const membership = user.memberships.find((item) => item.status === 'ACTIVE') ?? null;
    const issued = await this.sessions.create(user.id, membership?.tenantId ?? null, metadata);
    return {
      rawToken: issued.rawToken,
      expiresAt: issued.expiresAt,
      session: {
        userId: user.id, email: user.email, name: user.name, platformRole: user.platformRole,
        tenantId: membership?.tenantId ?? null, membershipRole: membership?.role ?? null,
      },
    };
  }

  async requestPasswordReset(rawEmail: string): Promise<{ accepted: true }> {
    const email = rawEmail.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE') return { accepted: true };
    const token = this.crypto.issueOpaqueToken(this.tokenPepper);
    const expiresAt = new Date(this.now().getTime() + TOKEN_TTL_MS);
    await this.prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: token.hash, expiresAt } });
    await this.email.sendPasswordReset(email, `${this.publicUrl}/reset-password?token=${encodeURIComponent(token.raw)}`);
    return { accepted: true };
  }

  async resetPassword(rawToken: string, password: string): Promise<{ reset: true }> {
    const tokenHash = this.crypto.hashOpaqueToken(rawToken, this.tokenPepper);
    const now = this.now();
    const passwordHash = await this.crypto.hashPassword(password);
    const userId = await this.prisma.$transaction(async (tx) => {
      const token = await tx.passwordResetToken.findUnique({ where: { tokenHash } });
      if (!token || token.usedAt || token.expiresAt <= now) throw new BadRequestException('Invalid or expired token');
      await tx.user.update({ where: { id: token.userId }, data: { passwordHash } });
      await tx.passwordResetToken.update({ where: { id: token.id }, data: { usedAt: now } });
      return token.userId;
    });
    await this.sessions.revokeAllForUser(userId);
    return { reset: true };
  }
}

function slug(value: string): string {
  return value.trim().toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'tenant';
}
