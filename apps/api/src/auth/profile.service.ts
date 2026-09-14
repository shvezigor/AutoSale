import { createHash, randomUUID } from 'node:crypto';

import type { AuthPrincipal } from '@autosale/contracts/auth';
import type { ChangePasswordRequest, ProfileResponse, UpdateProfileRequest } from '@autosale/contracts/profile';
import type { PrismaClient } from '@autosale/database';
import type { ObjectStorage } from '@autosale/integrations';
import { BadRequestException, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import sharp from 'sharp';

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

export type ProfileAvatarFile = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
};

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

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

  async replaceAvatar(principal: AuthPrincipal, file: ProfileAvatarFile): Promise<ProfileResponse> {
    if (file.size > MAX_AVATAR_BYTES || file.buffer.byteLength > MAX_AVATAR_BYTES) {
      throw new BadRequestException('PROFILE_AVATAR_TOO_LARGE');
    }
    if (!ALLOWED_AVATAR_TYPES.has(file.mimetype)) {
      throw new BadRequestException('PROFILE_AVATAR_INVALID');
    }

    let output: Buffer;
    try {
      output = await sharp(file.buffer, { failOn: 'error', limitInputPixels: 25_000_000 })
        .rotate()
        .resize(512, 512, { fit: 'cover', position: 'centre' })
        .webp({ quality: 82, effort: 4 })
        .toBuffer();
    } catch {
      throw new BadRequestException('PROFILE_AVATAR_INVALID');
    }

    const checksum = createHash('sha256').update(output).digest('hex');
    const storageKey = `users/${principal.userId}/avatars/${randomUUID()}.webp`;
    await this.storage.put({ key: storageKey, body: output, contentType: 'image/webp' });

    try {
      const user = await this.prisma.$transaction(async (transaction) => {
        const current = await transaction.user.findUnique({
          where: { id: principal.userId },
          select: { avatarStorageKey: true },
        });
        if (!current) throw new NotFoundException('PROFILE_NOT_FOUND');
        const updated = await transaction.user.update({
          where: { id: principal.userId },
          data: {
            avatarStorageKey: storageKey,
            avatarChecksum: checksum,
            avatarContentType: 'image/webp',
          },
          select: profileSelect,
        });
        if (current.avatarStorageKey && current.avatarStorageKey !== storageKey) {
          await transaction.userAvatarCleanup.create({
            data: { userId: principal.userId, storageKey: current.avatarStorageKey },
          });
        }
        await transaction.securityAuditLog.create({
          data: {
            userId: principal.userId,
            tenantId: principal.tenantId,
            actor: 'USER',
            action: 'PROFILE_AVATAR_REPLACED',
            result: 'SUCCESS',
            metadata: { operation: 'REPLACE', contentCategory: 'IMAGE' },
          },
        });
        return updated;
      });
      return this.response(user, principal.tenantId);
    } catch (error) {
      await this.cleanupUnreferencedAvatar(principal.userId, storageKey);
      throw error;
    }
  }

  async removeAvatar(principal: AuthPrincipal): Promise<ProfileResponse> {
    const user = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.user.findUnique({
        where: { id: principal.userId },
        select: { avatarStorageKey: true },
      });
      if (!current) throw new NotFoundException('PROFILE_NOT_FOUND');
      const updated = await transaction.user.update({
        where: { id: principal.userId },
        data: { avatarStorageKey: null, avatarChecksum: null, avatarContentType: null },
        select: profileSelect,
      });
      if (current.avatarStorageKey) {
        await transaction.userAvatarCleanup.create({
          data: { userId: principal.userId, storageKey: current.avatarStorageKey },
        });
      }
      await transaction.securityAuditLog.create({
        data: {
          userId: principal.userId,
          tenantId: principal.tenantId,
          actor: 'USER',
          action: 'PROFILE_AVATAR_REMOVED',
          result: 'SUCCESS',
          metadata: { operation: 'REMOVE', contentCategory: 'IMAGE' },
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

  private async cleanupUnreferencedAvatar(userId: string, storageKey: string): Promise<void> {
    try {
      await this.storage.delete(storageKey);
    } catch (error) {
      try {
        await this.prisma.userAvatarCleanup.create({ data: { userId, storageKey } });
      } catch (queueError) {
        this.logger.error({
          event: 'profile_avatar_cleanup_queue_failed',
          userId,
          errorCode: error instanceof Error ? error.name : 'UNKNOWN',
          queueErrorCode: queueError instanceof Error ? queueError.name : 'UNKNOWN',
        });
      }
    }
  }
}

function profileAvatarUrl(user: Pick<ProfileUser, 'avatarStorageKey' | 'avatarChecksum'>): string | null {
  return user.avatarStorageKey
    ? `/api/media/profile/avatar?v=${encodeURIComponent(user.avatarChecksum ?? '1')}`
    : null;
}
