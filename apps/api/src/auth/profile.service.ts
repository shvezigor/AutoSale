import type { AuthPrincipal } from '@autosale/contracts/auth';
import type { ProfileResponse, UpdateProfileRequest } from '@autosale/contracts/profile';
import type { PrismaClient } from '@autosale/database';
import type { ObjectStorage } from '@autosale/integrations';
import { NotFoundException } from '@nestjs/common';

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
  constructor(
    private readonly prisma: PrismaClient,
    private readonly crypto: CryptoService,
    private readonly sessions: SessionService,
    private readonly storage: ObjectStorage,
  ) {
    void this.crypto;
    void this.sessions;
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
}

function profileAvatarUrl(user: Pick<ProfileUser, 'avatarStorageKey' | 'avatarChecksum'>): string | null {
  return user.avatarStorageKey
    ? `/api/media/profile/avatar?v=${encodeURIComponent(user.avatarChecksum ?? '1')}`
    : null;
}
