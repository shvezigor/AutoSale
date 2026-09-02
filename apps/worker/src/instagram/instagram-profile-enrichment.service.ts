import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@autosale/database';
import { CredentialCipher, MetaInstagramError, type MetaInstagramUserProfile } from '@autosale/integrations';

import { AvatarCopyError, type InstagramAvatarCopyService } from './instagram-avatar-copy.service.js';

const LEASE_MS = 5 * 60_000;
const RETRY_DELAY_MS = 5 * 60_000;
const REFRESH_INTERVAL_MS = 24 * 60 * 60_000;

export interface InstagramProfileEnrichmentJob {
  profileId: string;
  tenantId: string;
  participantId: string;
  refreshVersion: number;
}

interface ProfileClient {
  getUserProfile(participantId: string, accessToken: string): Promise<MetaInstagramUserProfile>;
}

interface AvatarCopier {
  copy(input: {
    tenantId: string;
    profileId: string;
    refreshVersion: number;
    leaseId: string;
    sourceUrl: string;
  }): ReturnType<InstagramAvatarCopyService['copy']>;
}

export class InstagramProfileEnrichmentService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly meta: ProfileClient,
    private readonly avatars: AvatarCopier,
    private readonly cipher: CredentialCipher,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async process(job: InstagramProfileEnrichmentJob): Promise<void> {
    const startedAt = this.now();
    const leaseId = randomUUID();
    const claimed = await this.prisma.instagramCustomerProfile.updateManyAndReturn({
      where: {
        id: job.profileId,
        tenantId: job.tenantId,
        participantId: job.participantId,
        refreshVersion: job.refreshVersion,
        OR: [
          { status: { in: ['PENDING', 'RETRYABLE_FAILURE'] }, nextAttemptAt: { lte: startedAt } },
          { status: 'PROCESSING', leaseExpiresAt: { lte: startedAt } },
        ],
      },
      data: {
        status: 'PROCESSING',
        leaseId,
        leaseExpiresAt: new Date(startedAt.getTime() + LEASE_MS),
        attempts: { increment: 1 },
      },
    });
    const profile = claimed[0];
    if (!profile || profile.leaseId !== leaseId) return;
    const claimedLeaseId = profile.leaseId;

    const connection = await this.prisma.instagramConnection.findFirst({
      where: {
        tenantId: job.tenantId,
        status: 'ACTIVE',
        encryptedAccessToken: { not: null },
        OR: [{ tokenExpiresAt: null }, { tokenExpiresAt: { gt: startedAt } }],
      },
      select: { encryptedAccessToken: true },
    });
    if (!connection?.encryptedAccessToken) {
      await this.markUnavailable(job, claimedLeaseId, 'META_PROFILE_CREDENTIAL_UNAVAILABLE', startedAt);
      return;
    }

    let accessToken: string;
    try {
      accessToken = this.cipher.decrypt(connection.encryptedAccessToken);
    } catch {
      await this.markUnavailable(job, claimedLeaseId, 'META_PROFILE_CREDENTIAL_INVALID', startedAt);
      return;
    }

    let result: MetaInstagramUserProfile;
    try {
      result = await this.meta.getUserProfile(job.participantId, accessToken);
    } catch (error) {
      if (isTransientMetaError(error)) {
        await this.markRetryable(job, claimedLeaseId, 'META_PROFILE_TRANSIENT', startedAt);
        throw error;
      }
      await this.markUnavailable(job, claimedLeaseId, 'META_PROFILE_UNAVAILABLE', startedAt);
      return;
    }

    const displayName = sanitizeDisplayName(result.name);
    const username = sanitizeUsername(result.username);
    let avatar = {
      sourceUrl: profile.avatarSourceUrl,
      storageKey: profile.avatarStorageKey,
      checksum: profile.avatarChecksum,
      contentType: profile.avatarContentType,
    };
    let avatarErrorCode: string | null = null;
    let copiedAvatarKey: string | null = null;

    if (!result.profilePictureUrl) {
      avatar = { sourceUrl: null, storageKey: null, checksum: null, contentType: null };
    } else if (result.profilePictureUrl !== profile.avatarSourceUrl || !profile.avatarStorageKey) {
      try {
        const copied = await this.avatars.copy({
          tenantId: job.tenantId,
          profileId: job.profileId,
          refreshVersion: job.refreshVersion,
          leaseId: claimedLeaseId,
          sourceUrl: result.profilePictureUrl,
        });
        avatar = {
          sourceUrl: result.profilePictureUrl,
          storageKey: copied.key,
          checksum: copied.checksum,
          contentType: copied.contentType,
        };
        copiedAvatarKey = copied.key;
      } catch (error) {
        if (!(error instanceof AvatarCopyError) || error.retryable) {
          await this.markRetryable(job, claimedLeaseId, 'META_AVATAR_TRANSIENT', startedAt);
          throw error;
        }
        avatarErrorCode = error.code;
      }
    }

    const refreshAfter = new Date(startedAt.getTime() + REFRESH_INTERVAL_MS);
    await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.instagramCustomerProfile.updateMany({
        where: fencedClaim(job, claimedLeaseId),
        data: {
          displayName,
          username,
          avatarSourceUrl: avatar.sourceUrl,
          avatarStorageKey: avatar.storageKey,
          avatarChecksum: avatar.checksum,
          avatarContentType: avatar.contentType,
          status: 'READY',
          nextAttemptAt: refreshAfter,
          refreshAfter,
          leaseId: null,
          leaseExpiresAt: null,
          lastErrorCode: avatarErrorCode,
          lastRefreshedAt: startedAt,
        },
      });
      if (updated.count === 0 && copiedAvatarKey) {
        await transaction.instagramAvatarCleanup.upsert({
          where: { storageKey: copiedAvatarKey },
          create: {
            tenantId: job.tenantId,
            storageKey: copiedAvatarKey,
            nextAttemptAt: startedAt,
          },
          update: {
            tenantId: job.tenantId,
            status: 'PENDING',
            attempts: 0,
            nextAttemptAt: startedAt,
            leaseId: null,
            leaseExpiresAt: null,
            lastErrorCode: null,
          },
        });
      }
    });
  }

  private async markRetryable(
    job: InstagramProfileEnrichmentJob,
    leaseId: string,
    code: string,
    now: Date,
  ): Promise<void> {
    await this.prisma.instagramCustomerProfile.updateMany({
      where: fencedClaim(job, leaseId),
      data: {
        status: 'RETRYABLE_FAILURE',
        nextAttemptAt: new Date(now.getTime() + RETRY_DELAY_MS),
        leaseId: null,
        leaseExpiresAt: null,
        lastErrorCode: code,
      },
    });
  }

  private async markUnavailable(
    job: InstagramProfileEnrichmentJob,
    leaseId: string,
    code: string,
    now: Date,
  ): Promise<void> {
    const refreshAfter = new Date(now.getTime() + REFRESH_INTERVAL_MS);
    await this.prisma.instagramCustomerProfile.updateMany({
      where: fencedClaim(job, leaseId),
      data: {
        status: 'UNAVAILABLE',
        nextAttemptAt: refreshAfter,
        refreshAfter,
        leaseId: null,
        leaseExpiresAt: null,
        lastErrorCode: code,
      },
    });
  }
}

function fencedClaim(job: InstagramProfileEnrichmentJob, leaseId: string) {
  return {
    id: job.profileId,
    tenantId: job.tenantId,
    participantId: job.participantId,
    refreshVersion: job.refreshVersion,
    status: 'PROCESSING',
    leaseId,
  } as const;
}

function isTransientMetaError(error: unknown): boolean {
  return error instanceof MetaInstagramError && (
    error.isTransient === true ||
    error.status === null ||
    error.status === 429 ||
    (error.status !== null && error.status >= 500)
  );
}

function sanitizeDisplayName(value: string | null): string | null {
  if (!value) return null;
  const normalized = value
    .normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  const limited = [...normalized].slice(0, 100).join('').trim();
  return limited === '' ? null : limited;
}

function sanitizeUsername(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.normalize('NFKC').trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9._]{1,30}$/.test(normalized)) return null;
  return normalized;
}
