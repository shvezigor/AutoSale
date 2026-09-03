import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createPrismaClient, type PrismaClient } from '@autosale/database';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { InstagramAvatarCleanupReconciler } from './instagram-avatar-cleanup-reconciler.js';

const NOW = new Date('2030-09-02T10:00:00.000Z');
const MIGRATIONS = [
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
] as const;

describe('InstagramAvatarCleanupReconciler', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let currentTime = NOW;
  const deleteObject = vi.fn();

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    const connectionString = container.getConnectionUri();
    const pool = new pg.Pool({ connectionString });
    for (const migrationName of MIGRATIONS) {
      await pool.query(await readFile(resolve(
        process.cwd(),
        `../../packages/database/prisma/migrations/${migrationName}/migration.sql`,
      ), 'utf8'));
    }
    await pool.end();
    prisma = createPrismaClient(connectionString);
  }, 60_000);

  beforeEach(async () => {
    currentTime = NOW;
    deleteObject.mockReset().mockResolvedValue(undefined);
    await prisma.instagramAvatarCleanup.deleteMany();
    await prisma.instagramCustomerProfile.deleteMany();
    await prisma.instagramConnection.deleteMany();
    await prisma.tenant.deleteMany();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it('deletes a replaced avatar only after the profile references its replacement', async () => {
    const profile = await seedProfile('replace', 'old-key');

    await prisma.instagramCustomerProfile.update({
      where: { id: profile.id },
      data: { avatarStorageKey: 'new-key', avatarChecksum: 'new', avatarContentType: 'image/webp' },
    });

    expect(await prisma.instagramCustomerProfile.findUniqueOrThrow({ where: { id: profile.id } }))
      .toMatchObject({ avatarStorageKey: 'new-key' });
    expect(await prisma.instagramAvatarCleanup.findUniqueOrThrow({ where: { storageKey: 'old-key' } }))
      .toMatchObject({ tenantId: profile.tenantId, status: 'PENDING' });

    await expect(reconciler().reconcile()).resolves.toEqual({ attempted: 1, deleted: 1, failed: 0, referenced: 0 });
    expect(deleteObject).toHaveBeenCalledOnce();
    expect(deleteObject).toHaveBeenCalledWith('old-key');
    expect(await prisma.instagramCustomerProfile.findUniqueOrThrow({ where: { id: profile.id } }))
      .toMatchObject({ avatarStorageKey: 'new-key' });
  });

  it('queues the previous avatar when Meta removes profile_pic', async () => {
    const profile = await seedProfile('remove', 'removed-key');

    await prisma.instagramCustomerProfile.update({
      where: { id: profile.id },
      data: { avatarSourceUrl: null, avatarStorageKey: null, avatarChecksum: null, avatarContentType: null },
    });

    expect(await prisma.instagramAvatarCleanup.findUniqueOrThrow({ where: { storageKey: 'removed-key' } }))
      .toMatchObject({ status: 'PENDING' });
    await reconciler().reconcile();
    expect(deleteObject).toHaveBeenCalledWith('removed-key');
  });

  it('keeps a failed delete durable, retries it when due, and does not replay a success', async () => {
    const profile = await seedProfile('retry', 'retry-key');
    await prisma.instagramCustomerProfile.update({
      where: { id: profile.id },
      data: { avatarStorageKey: null, avatarChecksum: null, avatarContentType: null },
    });
    deleteObject.mockRejectedValueOnce(new Error('storage unavailable')).mockResolvedValue(undefined);

    await expect(reconciler().reconcile()).resolves.toEqual({ attempted: 1, deleted: 0, failed: 1, referenced: 0 });
    expect(await prisma.instagramAvatarCleanup.findUniqueOrThrow({ where: { storageKey: 'retry-key' } }))
      .toMatchObject({ status: 'RETRYABLE_FAILURE', attempts: 1, nextAttemptAt: new Date(NOW.getTime() + 5 * 60_000) });

    currentTime = new Date(NOW.getTime() + 4 * 60_000);
    await expect(reconciler().reconcile()).resolves.toMatchObject({ attempted: 0 });
    currentTime = new Date(NOW.getTime() + 5 * 60_000);
    await expect(reconciler().reconcile()).resolves.toEqual({ attempted: 1, deleted: 1, failed: 0, referenced: 0 });
    await expect(reconciler().reconcile()).resolves.toMatchObject({ attempted: 0 });
    expect(deleteObject).toHaveBeenCalledTimes(2);
  });

  it('never deletes an object that became current again', async () => {
    const profile = await seedProfile('reuse', 'old-key');
    await prisma.instagramCustomerProfile.update({
      where: { id: profile.id },
      data: { avatarStorageKey: 'new-key', avatarChecksum: 'new', avatarContentType: 'image/webp' },
    });
    await prisma.instagramCustomerProfile.update({
      where: { id: profile.id },
      data: { avatarStorageKey: 'old-key', avatarChecksum: 'old', avatarContentType: 'image/jpeg' },
    });

    await expect(reconciler().reconcile()).resolves.toEqual({ attempted: 2, deleted: 1, failed: 0, referenced: 1 });
    expect(deleteObject).toHaveBeenCalledTimes(1);
    expect(deleteObject).toHaveBeenCalledWith('new-key');
  });

  it('queues avatars on disconnect and preserves cleanup work across tenant deletion', async () => {
    const disconnected = await seedProfile('disconnect', 'disconnect-key', true);
    await prisma.instagramConnection.update({
      where: { tenantId: disconnected.tenantId },
      data: { status: 'DISCONNECTED' },
    });
    expect(await prisma.instagramCustomerProfile.findUniqueOrThrow({ where: { id: disconnected.id } }))
      .toMatchObject({ avatarStorageKey: null });
    expect(await prisma.instagramAvatarCleanup.findUniqueOrThrow({ where: { storageKey: 'disconnect-key' } }))
      .toMatchObject({ status: 'PENDING' });

    const deleted = await seedProfile('deleted', 'tenant-delete-key');
    await prisma.conversation.create({
      data: {
        tenantId: deleted.tenantId,
        channel: 'INSTAGRAM',
        externalConversationId: 'participant-deleted',
        participantId: 'participant-deleted',
        profileId: deleted.id,
        lastMessageAt: NOW,
      },
    });
    await prisma.tenant.delete({ where: { id: deleted.tenantId } });
    expect(await prisma.instagramAvatarCleanup.findUniqueOrThrow({ where: { storageKey: 'tenant-delete-key' } }))
      .toMatchObject({ tenantId: deleted.tenantId, status: 'PENDING' });
  });

  function reconciler(): InstagramAvatarCleanupReconciler {
    return new InstagramAvatarCleanupReconciler(prisma, { delete: deleteObject }, () => currentTime);
  }

  async function seedProfile(key: string, avatarStorageKey: string, withConnection = false) {
    const tenant = await prisma.tenant.create({ data: { key, name: key } });
    if (withConnection) {
      await prisma.instagramConnection.create({
        data: { tenantId: tenant.id, externalAccountId: `account-${key}`, status: 'ACTIVE' },
      });
    }
    return prisma.instagramCustomerProfile.create({
      data: {
        tenantId: tenant.id,
        participantId: `participant-${key}`,
        avatarSourceUrl: 'https://scontent.fbcdn.net/avatar.jpg',
        avatarStorageKey,
        avatarChecksum: 'old',
        avatarContentType: 'image/jpeg',
        status: 'READY',
      },
    });
  }
});
