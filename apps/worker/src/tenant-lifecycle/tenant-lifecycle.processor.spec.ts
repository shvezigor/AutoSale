import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TenantLifecycleProcessor } from './tenant-lifecycle.processor.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const leaseId = '33333333-3333-4333-8333-333333333333';
const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('TenantLifecycleProcessor', () => {
  it('claims, uploads, verifies and publishes a ready export with a fenced lease', async () => {
    const updateMany = vi.fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    const tx = {
      $queryRaw: vi.fn(),
      tenantLifecycleRequest: {
        updateMany,
        findFirstOrThrow: vi.fn().mockResolvedValue({ attemptCount: 1 }),
      },
    };
    const prisma = { $transaction: vi.fn(async (operation: (value: unknown) => Promise<unknown>) => operation(tx)) };
    const storage = {
      putStream: vi.fn().mockResolvedValue({ key: 'key', etag: 'etag' }),
      head: vi.fn().mockResolvedValue({ contentLength: 7, contentType: 'application/zip', checksumSha256: Buffer.from('a'.repeat(64), 'hex').toString('base64') }),
      delete: vi.fn(),
    };
    const directory = await temporaryRoot();
    const archivePath = join(directory, 'prepared.zip');
    await writeFile(archivePath, 'archive');
    const writer = vi.fn().mockResolvedValue({
      archivePath, sha256Hex: 'a'.repeat(64), sha256Base64: Buffer.from('a'.repeat(64), 'hex').toString('base64'),
      sizeBytes: 7, manifestVersion: 1, datasetCounts: {}, objectCount: 0,
    });
    const processor = new TenantLifecycleProcessor(
      prisma as never, storage as never, writer, () => new Date('2026-10-02T09:00:00Z'), () => leaseId, () => directory,
    );

    await expect(processor.process({ tenantId, requestId })).resolves.toBe('EXPORT_READY');
    expect(updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: requestId, tenantId, leaseId, status: 'EXPORTING' }),
      data: expect.objectContaining({ status: 'EXPORT_READY', exportSha256: 'a'.repeat(64) }),
    }));
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('ignores an unclaimable request without writing an archive', async () => {
    const tx = { $queryRaw: vi.fn(), tenantLifecycleRequest: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } };
    const prisma = { $transaction: vi.fn(async (operation: (value: unknown) => Promise<unknown>) => operation(tx)) };
    const writer = vi.fn();
    const processor = new TenantLifecycleProcessor(
      prisma as never, { delete: vi.fn() } as never, writer, undefined, () => leaseId,
    );

    await expect(processor.process({ tenantId, requestId })).resolves.toBe('IGNORED');
    expect(writer).not.toHaveBeenCalled();
  });

  it('deletes its lease-specific upload when durable publication loses the lease', async () => {
    const updateMany = vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const tx = {
      $queryRaw: vi.fn(),
      tenantLifecycleRequest: { updateMany, findFirstOrThrow: vi.fn().mockResolvedValue({ attemptCount: 1 }) },
    };
    const prisma = { $transaction: vi.fn(async (operation: (value: unknown) => Promise<unknown>) => operation(tx)) };
    const directory = await temporaryRoot();
    const archivePath = join(directory, 'prepared.zip');
    await writeFile(archivePath, 'archive');
    const checksum = 'b'.repeat(64);
    const storage = {
      putStream: vi.fn().mockResolvedValue({ key: 'key', etag: 'etag' }),
      head: vi.fn().mockResolvedValue({ contentLength: 7, contentType: 'application/zip', checksumSha256: Buffer.from(checksum, 'hex').toString('base64') }),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const processor = new TenantLifecycleProcessor(
      prisma as never,
      storage as never,
      vi.fn().mockResolvedValue({ archivePath, sha256Hex: checksum, sha256Base64: Buffer.from(checksum, 'hex').toString('base64'), sizeBytes: 7, manifestVersion: 1, datasetCounts: {}, objectCount: 0 }),
      undefined,
      () => leaseId,
      () => directory,
    );

    await expect(processor.process({ tenantId, requestId })).resolves.toBe('IGNORED');
    expect(storage.delete).toHaveBeenCalledWith(expect.stringContaining(leaseId));
  });

  it('removes a rejected upload and stores only a bounded retry error', async () => {
    const updateMany = vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 });
    const tx = {
      $queryRaw: vi.fn(),
      tenantLifecycleRequest: { updateMany, findFirstOrThrow: vi.fn().mockResolvedValue({ attemptCount: 2 }) },
    };
    const prisma = { $transaction: vi.fn(async (operation: (value: unknown) => Promise<unknown>) => operation(tx)) };
    const directory = await temporaryRoot();
    const archivePath = join(directory, 'prepared.zip');
    await writeFile(archivePath, 'archive');
    const checksum = 'd'.repeat(64);
    const storage = {
      putStream: vi.fn().mockResolvedValue({ key: 'key', etag: 'etag' }),
      head: vi.fn().mockResolvedValue({ contentLength: 6, contentType: 'application/zip', checksumSha256: 'wrong' }),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const processor = new TenantLifecycleProcessor(
      prisma as never,
      storage as never,
      vi.fn().mockResolvedValue({ archivePath, sha256Hex: checksum, sha256Base64: Buffer.from(checksum, 'hex').toString('base64'), sizeBytes: 7, manifestVersion: 1, datasetCounts: {}, objectCount: 0 }),
      () => new Date('2026-10-02T09:00:00Z'),
      () => leaseId,
      () => directory,
    );

    await expect(processor.process({ tenantId, requestId })).resolves.toBe('FAILED');
    expect(storage.delete).toHaveBeenCalledWith(expect.stringContaining(leaseId));
    expect(updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'FAILED',
        lastErrorCode: 'TENANT_EXPORT_OBJECT_VERIFICATION_FAILED',
        nextAttemptAt: new Date('2026-10-02T09:01:00Z'),
      }),
    }));
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sales-aito-processor-test-'));
  roots.push(root);
  return root;
}
