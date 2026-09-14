import type { AuthPrincipal } from '@autosale/contracts/auth';
import type { ChangePasswordRequest, ProfileResponse, UpdateProfileRequest } from '@autosale/contracts/profile';
import type { PrismaClient } from '@autosale/database';
import type { ObjectStorage } from '@autosale/integrations';
import { BadRequestException, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';

import { CryptoService } from './crypto.service.js';
import { SessionService } from './session.service.js';

type ProfileUser = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  locale: string;
  passwordHash: string | null;
  avatarStorageKey: string | null;
  avatarChecksum: string | null;
  avatarContentType: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
  googleIdentity: { id: string } | null;
  memberships: Array<{
    tenantId: string;
    role: 'OWNER' | 'MANAGER';
    status: string;
  }>;
};

const profileSelect = {
  id: true,
  email: true,
  name: true,
  phone: true,
  locale: true,
  passwordHash: true,
  avatarStorageKey: true,
  avatarChecksum: true,
  avatarContentType: true,
  createdAt: true,
  lastLoginAt: true,
  googleIdentity: { select: { id: true } },
  memberships: { select: { tenantId: true, role: true, status: true } },
} as const;

export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly crypto: CryptoService,
    private readonly sessions: SessionService,
    private readonly storage: ObjectStorage,
  ) {
    void this.storage;
  }

  async get(principal: AuthPrincipal): Promise<ProfileResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: principal.userId },
      select: profileSelect,
    });
    if (!user) throw new NotFoundException('PROFILE_NOT_FOUND');
    return this.response(user, principal.tenantId);
  }

  async update(principal: AuthPrincipal, input: UpdateProfileRequest): Promise<ProfileResponse> {
    const user = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.user.update({
        where: { id: principal.userId },
        data: { name: input.name, phone: input.phone, locale: input.locale },
        select: profileSelect,
      });
      await transaction.securityAuditLog.create({
        data: {
          userId: principal.userId,
          tenantId: principal.tenantId,
          actor: 'USER',
          action: 'PROFILE_UPDATED',
          result: 'SUCCESS',
          metadata: { fields: ['locale', 'name', 'phone'] },
        },
      });
      return updated;
    });
    return this.response(user, principal.tenantId);
  }

  async changePassword(
    principal: AuthPrincipal,
    input: ChangePasswordRequest,
  ): Promise<{ changed: true; revokedSessions: number }> {
    const user = await this.prisma.user.findUnique({
      where: { id: principal.userId },
      select: { passwordHash: true },
    });
    if (!user?.passwordHash) {
      await this.audit(principal, 'PROFILE_PASSWORD_CHANGE_REJECTED', 'FAILURE', { reason: 'NO_LOCAL_PASSWORD' });
      throw new BadRequestException('PROFILE_PASSWORD_UNAVAILABLE');
    }
    if (!await this.crypto.verifyPassword(user.passwordHash, input.currentPassword)) {
      await this.audit(principal, 'PROFILE_PASSWORD_CHANGE_REJECTED', 'FAILURE', { reason: 'CURRENT_PASSWORD_INVALID' });
      throw new UnauthorizedException('PROFILE_CURRENT_PASSWORD_INVALID');
    }

    const passwordHash = await this.crypto.hashPassword(input.newPassword);
    await this.prisma.user.update({ where: { id: principal.userId }, data: { passwordHash } });
    const revokedSessions = await this.sessions.revokeOthersForUser(principal.userId, principal.sessionId);
    await this.audit(principal, 'PROFILE_PASSWORD_CHANGED', 'SUCCESS', { revokedSessions });
    return { changed: true, revokedSessions };
  }

  private response(user: ProfileUser, tenantId: string | null): ProfileResponse {
    const membership = tenantId
      ? user.memberships.find((item) => item.tenantId === tenantId && item.status === 'ACTIVE')
      : undefined;
    const signInMethods: ProfileResponse['signInMethods'] = [];
    if (user.passwordHash) signInMethods.push('PASSWORD');
    if (user.googleIdentity) signInMethods.push('GOOGLE');
    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      locale: user.locale === 'en' ? 'en' : 'uk',
      avatarUrl: profileAvatarUrl(user),
      membershipRole: membership?.role ?? null,
      signInMethods,
      canChangePassword: Boolean(user.passwordHash),
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    };
  }

  private async audit(
    principal: AuthPrincipal,
    action: string,
    result: string,
    metadata: Record<string, string | number>,
  ): Promise<void> {
    try {
      await this.prisma.securityAuditLog.create({
        data: {
          userId: principal.userId,
          tenantId: principal.tenantId,
          actor: 'USER',
          action,
          result,
          metadata,
        },
      });
    } catch (error) {
      this.logger.warn({
        event: 'profile_security_audit_failed',
        userId: principal.userId,
        action,
        errorCode: error instanceof Error ? error.name : 'UNKNOWN',
      });
    }
  }
}

function profileAvatarUrl(user: Pick<ProfileUser, 'avatarStorageKey' | 'avatarChecksum'>): string | null {
  return user.avatarStorageKey
    ? `/api/media/profile/avatar?v=${encodeURIComponent(user.avatarChecksum ?? '1')}`
    : null;
}
