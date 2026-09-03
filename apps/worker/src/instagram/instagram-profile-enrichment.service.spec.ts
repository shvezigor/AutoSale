import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createPrismaClient, type PrismaClient } from '@autosale/database';
import { CredentialCipher, MetaInstagramError } from '@autosale/integrations';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AvatarCopyError, InstagramAvatarCopyService } from './instagram-avatar-copy.service.js';
import { InstagramAvatarCleanupReconciler } from './instagram-avatar-cleanup-reconciler.js';
import { InstagramProfileEnrichmentService } from './instagram-profile-enrichment.service.js';
import { InstagramProfileReconciler } from './instagram-profile-reconciler.js';

const NOW = new Date('2026-09-02T10:00:00.000Z');
const PARTICIPANT = 'ig-user-shared';

describe('InstagramProfileEnrichmentService', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  const cipher = new CredentialCipher(Buffer.alloc(32, 7));
  const getUserProfile = vi.fn();
  const copy = vi.fn();

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    const connectionString = container.getConnectionUri();
    const pool = new pg.Pool({ connectionString });
    for (const migrationName of [
      '20260826090000_init_webhook_events',
      '20260826123000_conversations_messages',
      '20260827160000_self_hosted_auth',
      '20260827170000_tenant_access_status',
      '20260827230000_instagram_connections',
      '20260828_meta_instagram_oauth',
      '20260828150000_instagram_oauth_attempt_guard',
      '20260829120000_instagram_credential_cleanup_queue',
      '20260902090000_instagram_customer_profiles',
      '20260902130000_instagram_avatar_cleanup',
    ]) {
      await pool.query(await readFile(resolve(
        process.cwd(),
        `../../packages/database/prisma/migrations/${migrationName}/migration.sql`,
      ), 'utf8'));
    }
    await pool.end();
    prisma = createPrismaClient(connectionString);
  }, 60_000);

  beforeEach(async () => {
    getUserProfile.mockReset();
    copy.mockReset();
    await prisma.instagramAvatarCleanup.deleteMany();
    await prisma.instagramCustomerProfile.deleteMany();
    await prisma.instagramConnection.deleteMany();
    await prisma.tenant.deleteMany();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it('sanitizes and stores the best Meta fields and a controlled avatar copy', async () => {
    const profile = await seedProfile('a');
    getUserProfile.mockResolvedValue({
      name: `  Olena\u0000   Koval ${'x'.repeat(150)}  `,
      username: 'olena.koval',
      profilePictureUrl: 'https://scontent.cdninstagram.com/avatar-a.jpg',
    });
    copy.mockResolvedValue({
      key: `tenants/${profile.tenantId}/instagram/profiles/${profile.id}/sha256/a.jpg`,
      checksum: 'checksum-a',
      contentType: 'image/jpeg',
    });

    await service().process(job(profile));

    expect(getUserProfile).toHaveBeenCalledWith(PARTICIPANT, 'profile-access-token');
    expect(await prisma.instagramCustomerProfile.findUniqueOrThrow({ where: { id: profile.id } }))
      .toMatchObject({
        displayName: expect.stringMatching(/^Olena Koval x+$/),
        username: 'olena.koval',
        avatarSourceUrl: 'https://scontent.cdninstagram.com/avatar-a.jpg',
        avatarStorageKey: expect.stringContaining('/sha256/a.jpg'),
        avatarChecksum: 'checksum-a',
        avatarContentType: 'image/jpeg',
        status: 'READY',
        refreshVersion: 1,
        lastErrorCode: null,
        lastRefreshedAt: NOW,
      });
    const stored = await prisma.instagramCustomerProfile.findUniqueOrThrow({ where: { id: profile.id } });
    expect([...stored.displayName!]).toHaveLength(100);
  });

  it('uses one profile/object operation when the same enrichment job is delivered twice', async () => {
    const profile = await seedProfile('a');
    getUserProfile.mockResolvedValue({
      name: null,
      username: 'olena.koval',
      profilePictureUrl: 'https://scontent.fbcdn.net/avatar.jpg',
    });
    copy.mockResolvedValue({ key: 'tenant-avatar', checksum: 'same', contentType: 'image/jpeg' });

    await service().process(job(profile));
    await service().process(job(profile));

    expect(getUserProfile).toHaveBeenCalledTimes(1);
    expect(copy).toHaveBeenCalledTimes(1);
    expect(await prisma.instagramCustomerProfile.count({
      where: { tenantId: profile.tenantId, participantId: PARTICIPANT },
    })).toBe(1);
  });

  it('refreshes a changed avatar under a new fenced profile version', async () => {
    const profile = await seedProfile('a', {
      status: 'READY',
      avatarSourceUrl: 'https://scontent.fbcdn.net/old.jpg',
      avatarStorageKey: 'old-key',
      avatarChecksum: 'old-checksum',
      avatarContentType: 'image/jpeg',
      refreshVersion: 4,
      refreshAfter: new Date('2026-09-01T00:00:00.000Z'),
    });
    await prisma.instagramCustomerProfile.update({
      where: { id: profile.id },
      data: { status: 'PENDING', refreshVersion: 5 },
    });
    getUserProfile.mockResolvedValue({
      name: 'Olena',
      username: 'olena',
      profilePictureUrl: 'https://scontent.fbcdn.net/new.jpg',
    });
    copy.mockResolvedValue({ key: 'new-key', checksum: 'new-checksum', contentType: 'image/webp' });

    await service().process({ ...job(profile), refreshVersion: 5 });

    expect(await prisma.instagramCustomerProfile.findUniqueOrThrow({ where: { id: profile.id } }))
      .toMatchObject({ avatarStorageKey: 'new-key', avatarChecksum: 'new-checksum', refreshVersion: 5 });
    expect(await prisma.instagramAvatarCleanup.findUniqueOrThrow({ where: { storageKey: 'old-key' } }))
      .toMatchObject({ tenantId: profile.tenantId, status: 'PENDING' });
  });

  it('durably records a copied orphan when the fenced profile switch loses a race', async () => {
    const profile = await seedProfile('a', {
      status: 'READY',
      avatarSourceUrl: 'https://scontent.fbcdn.net/old.jpg',
      avatarStorageKey: 'old-key',
      avatarChecksum: 'old-checksum',
      avatarContentType: 'image/jpeg',
      refreshVersion: 4,
    });
    await prisma.instagramCustomerProfile.update({
      where: { id: profile.id },
      data: { status: 'PENDING', refreshVersion: 5 },
    });
    getUserProfile.mockResolvedValue({
      name: 'Olena',
      username: 'olena',
      profilePictureUrl: 'https://scontent.fbcdn.net/new.jpg',
    });
    copy.mockImplementationOnce(async () => {
      await prisma.instagramCustomerProfile.update({
        where: { id: profile.id },
        data: { refreshVersion: 6 },
      });
      return { key: 'orphan-key', checksum: 'orphan', contentType: 'image/webp' };
    });

    await service().process({ ...job(profile), refreshVersion: 5 });

    expect(await prisma.instagramCustomerProfile.findUniqueOrThrow({ where: { id: profile.id } }))
      .toMatchObject({ avatarStorageKey: 'old-key', refreshVersion: 6 });
    expect(await prisma.instagramAvatarCleanup.findUniqueOrThrow({ where: { storageKey: 'orphan-key' } }))
      .toMatchObject({ tenantId: profile.tenantId, status: 'PENDING' });
  });

  it('keeps later reverted avatar bytes available while an older cleanup is deleting', async () => {
    const profile = await seedProfile('cleanup-race');
    await prisma.instagramAvatarCleanup.deleteMany();
    const avatarA = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const avatarB = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x11]);
    const objects = new Map<string, Uint8Array>();
    let signalDeleteStarted!: () => void;
    let releaseDelete!: () => void;
    const deleteStarted = new Promise<void>((resolve) => { signalDeleteStarted = resolve; });
    const deleteReleased = new Promise<void>((resolve) => { releaseDelete = resolve; });
    const storage = {
      put: vi.fn(async (input: { key: string; body: Uint8Array }) => {
        objects.set(input.key, input.body);
        return { key: input.key, etag: 'etag' };
      }),
      get: vi.fn(),
      delete: vi.fn(async (key: string) => {
        signalDeleteStarted();
        await deleteReleased;
        objects.delete(key);
      }),
    };
    const avatarCopier = new InstagramAvatarCopyService(storage, {
      resolveHost: async () => [{ address: '157.240.1.10', family: 4 }],
      requestPinned: async (url) => imageResponse(
        url.pathname.endsWith('/a.jpg') ? avatarA : avatarB,
        'image/jpeg',
      ),
    });
    const enrichment = new InstagramProfileEnrichmentService(
      prisma,
      { getUserProfile } as never,
      avatarCopier,
      cipher,
      () => NOW,
    );

    getUserProfile.mockResolvedValue({ name: 'Olena', username: 'olena', profilePictureUrl: 'https://scontent.fbcdn.net/a.jpg' });
    await enrichment.process(job(profile));
    const firstKey = (await prisma.instagramCustomerProfile.findUniqueOrThrow({ where: { id: profile.id } })).avatarStorageKey!;

    await prisma.instagramCustomerProfile.update({
      where: { id: profile.id },
      data: { status: 'PENDING', nextAttemptAt: NOW, refreshVersion: 2 },
    });
    getUserProfile.mockResolvedValue({ name: 'Olena', username: 'olena', profilePictureUrl: 'https://scontent.fbcdn.net/b.jpg' });
    await enrichment.process({ ...job(profile), refreshVersion: 2 });

    const cleanup = new InstagramAvatarCleanupReconciler(prisma, storage, () => new Date('2030-09-02T10:00:00.000Z'));
    const cleanupRunning = cleanup.reconcile();
    await deleteStarted;

    await prisma.instagramCustomerProfile.update({
      where: { id: profile.id },
      data: { status: 'PENDING', nextAttemptAt: NOW, refreshVersion: 3 },
    });
    getUserProfile.mockResolvedValue({ name: 'Olena', username: 'olena', profilePictureUrl: 'https://scontent.fbcdn.net/a.jpg' });
    await enrichment.process({ ...job(profile), refreshVersion: 3 });
    const currentKey = (await prisma.instagramCustomerProfile.findUniqueOrThrow({ where: { id: profile.id } })).avatarStorageKey!;

    releaseDelete();
    await expect(cleanupRunning).resolves.toMatchObject({ deleted: 1 });

    expect(firstKey).toMatch(/\/versions\/1\/leases\/[a-f\d-]+\/sha256\//);
    expect(currentKey).toMatch(/\/versions\/3\/leases\/[a-f\d-]+\/sha256\//);
    expect(currentKey).not.toBe(firstKey);
    expect(objects.get(currentKey)).toEqual(avatarA);
  });

  it('keeps same-version reclaimed avatar bytes available while stale cleanup deletes the losing claim', async () => {
    let currentTime = NOW;
    const profile = await seedProfile('same-version-reclaim');
    await prisma.instagramAvatarCleanup.deleteMany();
    const avatar = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const objects = new Map<string, Uint8Array>();
    let signalOldPutStarted!: () => void;
    let releaseOldPut!: () => void;
    let signalNewPutStarted!: () => void;
    let releaseNewPut!: () => void;
    let signalDeleteStarted!: () => void;
    let releaseDelete!: () => void;
    const oldPutStarted = new Promise<void>((resolve) => { signalOldPutStarted = resolve; });
    const oldPutReleased = new Promise<void>((resolve) => { releaseOldPut = resolve; });
    const newPutStarted = new Promise<void>((resolve) => { signalNewPutStarted = resolve; });
    const newPutReleased = new Promise<void>((resolve) => { releaseNewPut = resolve; });
    const deleteStarted = new Promise<void>((resolve) => { signalDeleteStarted = resolve; });
    const deleteReleased = new Promise<void>((resolve) => { releaseDelete = resolve; });
    let putAttempt = 0;
    const storage = {
      put: vi.fn(async (input: { key: string; body: Uint8Array }) => {
        const attempt = ++putAttempt;
        if (attempt === 1) {
          objects.set(input.key, input.body);
          signalOldPutStarted();
          await oldPutReleased;
        } else {
          signalNewPutStarted();
          await newPutReleased;
          objects.set(input.key, input.body);
        }
        return { key: input.key, etag: `etag-${attempt}` };
      }),
      get: vi.fn(),
      delete: vi.fn(async (key: string) => {
        signalDeleteStarted();
        await deleteReleased;
        objects.delete(key);
      }),
    };
    const avatarCopier = new InstagramAvatarCopyService(storage, {
      resolveHost: async () => [{ address: '157.240.1.10', family: 4 }],
      requestPinned: async () => imageResponse(avatar, 'image/jpeg'),
    });
    const enrichment = new InstagramProfileEnrichmentService(
      prisma,
      { getUserProfile } as never,
      avatarCopier,
      cipher,
      () => currentTime,
    );
    getUserProfile.mockResolvedValue({
      name: 'Olena',
      username: 'olena',
      profilePictureUrl: 'https://scontent.fbcdn.net/avatar.jpg',
    });

    const oldProcessing = enrichment.process(job(profile));
    await oldPutStarted;

    currentTime = new Date(NOW.getTime() + 5 * 60_000);
    const newProcessing = enrichment.process(job(profile));
    await newPutStarted;

    releaseOldPut();
    await oldProcessing;
    const losingCleanup = await prisma.instagramAvatarCleanup.findFirstOrThrow();

    const cleanup = new InstagramAvatarCleanupReconciler(
      prisma,
      storage,
      () => new Date('2030-09-02T10:00:00.000Z'),
    );
    const cleanupRunning = cleanup.reconcile();
    await deleteStarted;

    releaseNewPut();
    await newProcessing;
    const currentKey = (await prisma.instagramCustomerProfile.findUniqueOrThrow({
      where: { id: profile.id },
    })).avatarStorageKey!;

    releaseDelete();
    await expect(cleanupRunning).resolves.toMatchObject({ deleted: 1 });

    expect(losingCleanup.storageKey).toMatch(/\/versions\/1\/leases\/[a-f\d-]+\/sha256\//);
    expect(currentKey).toMatch(/\/versions\/1\/leases\/[a-f\d-]+\/sha256\//);
    expect(currentKey).not.toBe(losingCleanup.storageKey);
    expect(objects.get(currentKey)).toEqual(avatar);
  });

  it('preserves the previous good profile and avatar on a transient Meta failure', async () => {
    const profile = await seedProfile('a', {
      displayName: 'Previous Name',
      username: 'previous',
      avatarSourceUrl: 'https://scontent.fbcdn.net/previous.jpg',
      avatarStorageKey: 'previous-key',
      avatarChecksum: 'previous-checksum',
      avatarContentType: 'image/jpeg',
      refreshVersion: 2,
    });
    getUserProfile.mockRejectedValue(new MetaInstagramError(503, 2, true));

    await expect(service().process(job(profile))).rejects.toBeInstanceOf(MetaInstagramError);

    expect(await prisma.instagramCustomerProfile.findUniqueOrThrow({ where: { id: profile.id } }))
      .toMatchObject({
        displayName: 'Previous Name',
        username: 'previous',
        avatarStorageKey: 'previous-key',
        avatarChecksum: 'previous-checksum',
        status: 'RETRYABLE_FAILURE',
        lastErrorCode: 'META_PROFILE_TRANSIENT',
      });
  });

  it('dispatches a new due attempt after an immediate BullMQ retry skipped the retry window', async () => {
    let currentTime = NOW;
    const profile = await seedProfile('a');
    const retainedJobs = new Map<string, ReturnType<typeof job>>();
    const queue = {
      add: vi.fn(async (_name: string, data: ReturnType<typeof job>, options: { jobId: string }) => {
        if (!retainedJobs.has(options.jobId)) retainedJobs.set(options.jobId, data);
      }),
    };
    const reconciler = new InstagramProfileReconciler(prisma, queue as never, () => currentTime);
    const enrichment = service(() => currentTime);
    getUserProfile
      .mockRejectedValueOnce(new MetaInstagramError(503, 2, true))
      .mockResolvedValueOnce({ name: 'Recovered', username: 'recovered', profilePictureUrl: null });

    await reconciler.reconcile();
    const firstJob = [...retainedJobs.values()][0]!;
    await expect(enrichment.process(firstJob)).rejects.toBeInstanceOf(MetaInstagramError);

    await enrichment.process(firstJob);
    expect(getUserProfile).toHaveBeenCalledTimes(1);
    expect((await prisma.instagramCustomerProfile.findUniqueOrThrow({ where: { id: profile.id } })).attempts)
      .toBe(1);

    currentTime = new Date(NOW.getTime() + 5 * 60_000);
    await reconciler.reconcile();
    expect(retainedJobs.size).toBe(2);
    const dueJob = [...retainedJobs.values()][1]!;
    await enrichment.process(dueJob);

    expect(getUserProfile).toHaveBeenCalledTimes(2);
    expect(await prisma.instagramCustomerProfile.findUniqueOrThrow({ where: { id: profile.id } }))
      .toMatchObject({ status: 'READY', displayName: 'Recovered', attempts: 2 });
  });

  it('stores an empty successful response without inventing a fallback profile', async () => {
    const profile = await seedProfile('a');
    getUserProfile.mockResolvedValue({ name: null, username: null, profilePictureUrl: null });

    await service().process(job(profile));

    expect(await prisma.instagramCustomerProfile.findUniqueOrThrow({ where: { id: profile.id } }))
      .toMatchObject({ displayName: null, username: null, avatarStorageKey: null, status: 'READY' });
  });

  it('keeps profile writes inside the supplied tenant even when another tenant has the same participant id', async () => {
    const profileA = await seedProfile('a');
    const profileB = await seedProfile('b');
    getUserProfile.mockResolvedValue({ name: 'Tenant A', username: 'tenant_a', profilePictureUrl: null });

    await service().process(job(profileA));
    await service().process({ ...job(profileA), tenantId: profileB.tenantId });

    expect((await prisma.instagramCustomerProfile.findUniqueOrThrow({ where: { id: profileA.id } })).displayName)
      .toBe('Tenant A');
    expect((await prisma.instagramCustomerProfile.findUniqueOrThrow({ where: { id: profileB.id } })).displayName)
      .toBeNull();
    expect(getUserProfile).toHaveBeenCalledTimes(1);
  });

  it('keeps names and rejects an unsafe avatar without storing its remote URL', async () => {
    const profile = await seedProfile('a');
    getUserProfile.mockResolvedValue({
      name: 'Safe Name',
      username: 'safe_name',
      profilePictureUrl: 'https://attacker.test/avatar.jpg',
    });
    copy.mockRejectedValue(new AvatarCopyError('UNSAFE_AVATAR_URL', false, 'unsafe'));

    await service().process(job(profile));

    expect(await prisma.instagramCustomerProfile.findUniqueOrThrow({ where: { id: profile.id } }))
      .toMatchObject({
        displayName: 'Safe Name',
        username: 'safe_name',
        avatarSourceUrl: null,
        avatarStorageKey: null,
        status: 'READY',
        lastErrorCode: 'UNSAFE_AVATAR_URL',
      });
  });

  function service(clock: () => Date = () => NOW): InstagramProfileEnrichmentService {
    return new InstagramProfileEnrichmentService(
      prisma,
      { getUserProfile } as never,
      { copy } as never,
      cipher,
      clock,
    );
  }

  async function seedProfile(
    tenantKey: string,
    data: Record<string, unknown> = {},
  ) {
    const tenant = await prisma.tenant.create({ data: { key: tenantKey, name: tenantKey } });
    await prisma.instagramConnection.create({
      data: {
        tenantId: tenant.id,
        externalAccountId: `account-${tenantKey}`,
        status: 'ACTIVE',
        encryptedAccessToken: cipher.encrypt('profile-access-token'),
        tokenExpiresAt: new Date('2026-10-01T00:00:00.000Z'),
      },
    });
    return prisma.instagramCustomerProfile.create({
      data: {
        tenantId: tenant.id,
        participantId: PARTICIPANT,
        status: 'PENDING',
        nextAttemptAt: NOW,
        ...data,
      },
    });
  }
});

function job(profile: { id: string; tenantId: string; participantId: string; refreshVersion: number }) {
  return {
    profileId: profile.id,
    tenantId: profile.tenantId,
    participantId: profile.participantId,
    refreshVersion: profile.refreshVersion,
  };
}

function imageResponse(body: Uint8Array, contentType: string) {
  return {
    status: 200,
    headers: { 'content-type': contentType },
    body: (async function* () { yield body; })(),
  };
}
