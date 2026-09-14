import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createPrismaClient, type PrismaClient } from '@autosale/database';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { UserAvatarCleanupReconciler } from './user-avatar-cleanup.reconciler.js';

const NOW = new Date('2030-09-14T10:00:00.000Z');

describe('UserAvatarCleanupReconciler', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let currentTime = NOW;
  const deleteObject = vi.fn();

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    const connectionString = container.getConnectionUri();
    const pool = new pg.Pool({ connectionString });
    const migrationsDirectory = resolve(process.cwd(), '../../packages/database/prisma/migrations');
    const migrations = (await readdir(migrationsDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const migration of migrations) {
      await pool.query(await readFile(resolve(migrationsDirectory, migration, 'migration.sql'), 'utf8'));
    }
    await pool.end();
    prisma = createPrismaClient(connectionString);
  }, 60_000);

  beforeEach(async () => {
    currentTime = NOW;
    deleteObject.mockReset().mockResolvedValue(undefined);
    await prisma.userAvatarCleanup.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it('leases a due cleanup before deleting it and completes the row', async () => {
    const cleanup = await seedCleanup('due-key');
    deleteObject.mockImplementationOnce(async () => {
      const leased = await prisma.userAvatarCleanup.findUniqueOrThrow({ where: { id: cleanup.id } });
      expect(leased).toMatchObject({ status: 'PROCESSING' });
      expect(leased.leaseUntil).toEqual(new Date(NOW.getTime() + 60_000));
    });

    await expect(reconciler().runOnce()).resolves.toEqual({ deleted: 1, retried: 0, deadLettered: 0 });

    expect(deleteObject).toHaveBeenCalledWith('due-key');
    await expect(prisma.userAvatarCleanup.findUniqueOrThrow({ where: { id: cleanup.id } }))
      .resolves.toMatchObject({ status: 'COMPLETED', attempts: 0, leaseUntil: null, lastErrorCode: null });
  });

  it('keeps a transient deletion failure durable with exponential backoff', async () => {
    const cleanup = await seedCleanup('retry-key');
    deleteObject.mockRejectedValueOnce(new TypeError('storage unavailable'));

    await expect(reconciler().runOnce()).resolves.toEqual({ deleted: 0, retried: 1, deadLettered: 0 });

    await expect(prisma.userAvatarCleanup.findUniqueOrThrow({ where: { id: cleanup.id } }))
      .resolves.toMatchObject({
        status: 'PENDING',
        attempts: 1,
        nextAttemptAt: new Date(NOW.getTime() + 2 * 60_000),
        leaseUntil: null,
        lastErrorCode: 'TypeError',
      });
  });

  it('dead-letters the eighth failed deletion attempt', async () => {
    const cleanup = await seedCleanup('dead-key', { attempts: 7 });
    deleteObject.mockRejectedValueOnce(new Error('still unavailable'));

    await expect(reconciler().runOnce()).resolves.toEqual({ deleted: 0, retried: 0, deadLettered: 1 });

    await expect(prisma.userAvatarCleanup.findUniqueOrThrow({ where: { id: cleanup.id } }))
      .resolves.toMatchObject({ status: 'DEAD_LETTER', attempts: 8, leaseUntil: null, lastErrorCode: 'Error' });
  });

  it('reschedules an object that is still referenced by a user', async () => {
    const cleanup = await seedCleanup('current-key', {}, 'current-key');

    await expect(reconciler().runOnce()).resolves.toEqual({ deleted: 0, retried: 1, deadLettered: 0 });

    expect(deleteObject).not.toHaveBeenCalled();
    await expect(prisma.userAvatarCleanup.findUniqueOrThrow({ where: { id: cleanup.id } }))
      .resolves.toMatchObject({
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt: new Date(NOW.getTime() + 60 * 60_000),
        leaseUntil: null,
      });
  });

  it('reclaims an expired lease without touching an active lease', async () => {
    const expired = await seedCleanup('expired-key', {
      status: 'PROCESSING',
      leaseUntil: new Date(NOW.getTime() - 1),
    });
    const active = await seedCleanup('active-key', {
      status: 'PROCESSING',
      leaseUntil: new Date(NOW.getTime() + 1),
    });

    await expect(reconciler().runOnce()).resolves.toEqual({ deleted: 1, retried: 0, deadLettered: 0 });

    expect(deleteObject).toHaveBeenCalledWith('expired-key');
    expect(deleteObject).not.toHaveBeenCalledWith('active-key');
    await expect(prisma.userAvatarCleanup.findUniqueOrThrow({ where: { id: expired.id } }))
      .resolves.toMatchObject({ status: 'COMPLETED' });
    await expect(prisma.userAvatarCleanup.findUniqueOrThrow({ where: { id: active.id } }))
      .resolves.toMatchObject({ status: 'PROCESSING', leaseUntil: new Date(NOW.getTime() + 1) });
  });

  function reconciler(): UserAvatarCleanupReconciler {
    return new UserAvatarCleanupReconciler(prisma, { delete: deleteObject }, () => currentTime);
  }

  async function seedCleanup(
    storageKey: string,
    cleanup: { status?: string; attempts?: number; leaseUntil?: Date } = {},
    avatarStorageKey: string | null = null,
  ) {
    const user = await prisma.user.create({
      data: {
        email: `${storageKey}@example.com`,
        name: storageKey,
        status: 'ACTIVE',
        avatarStorageKey,
        avatarChecksum: avatarStorageKey ? 'checksum' : null,
        avatarContentType: avatarStorageKey ? 'image/webp' : null,
      },
    });
    return prisma.userAvatarCleanup.create({
      data: {
        userId: user.id,
        storageKey,
        status: cleanup.status ?? 'PENDING',
        attempts: cleanup.attempts ?? 0,
        nextAttemptAt: NOW,
        ...(cleanup.leaseUntil ? { leaseUntil: cleanup.leaseUntil } : {}),
      },
    });
  }
});
