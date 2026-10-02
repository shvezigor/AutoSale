import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { TenantLifecycleJob } from '@autosale/contracts';
import type { PrismaClient } from '@autosale/database';
import { withTenantTransaction } from '@autosale/database';
import type { StreamingObjectStorage } from '@autosale/integrations';

import { type PreparedTenantExport, writeTenantExport } from './tenant-export-writer.js';

const LEASE_MS = 15 * 60_000;
const ARTIFACT_TTL_MS = 7 * 24 * 60 * 60_000;
const MAX_RETRY_MS = 6 * 60 * 60_000;

type ExportWriter = (input: Parameters<typeof writeTenantExport>[0]) => Promise<PreparedTenantExport>;
type ProcessorStorage = Pick<StreamingObjectStorage, 'putStream' | 'head' | 'delete' | 'getStream'>;

export class TenantLifecycleProcessor {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: ProcessorStorage,
    private readonly writer: ExportWriter = writeTenantExport,
    private readonly now: () => Date = () => new Date(),
    private readonly uuid: () => string = randomUUID,
    private readonly createDirectory: () => string | Promise<string> = () => mkdtemp(join(tmpdir(), 'sales-aito-tenant-export-')),
  ) {}

  async process(job: TenantLifecycleJob): Promise<'EXPORT_READY' | 'FAILED' | 'IGNORED'> {
    const leaseId = this.uuid();
    const startedAt = this.now();
    const attemptCount = await this.claim(job, leaseId, startedAt);
    if (attemptCount === null) return 'IGNORED';

    const directory = await this.createDirectory();
    const objectKey = `tenant-lifecycle/${job.tenantId}/${job.requestId}/export-${leaseId}.zip`;
    let uploaded = false;
    try {
      const prepared = await this.writer({
        prisma: this.prisma,
        storage: this.storage,
        tenantId: job.tenantId,
        requestId: job.requestId,
        directory,
        snapshotAt: startedAt,
      });
      await this.storage.putStream({
        key: objectKey,
        body: createReadStream(prepared.archivePath),
        contentType: 'application/zip',
        contentLength: prepared.sizeBytes,
        checksumSha256: prepared.sha256Base64,
      });
      uploaded = true;
      const head = await this.storage.head(objectKey);
      if (
        head.contentType !== 'application/zip'
        || head.contentLength !== prepared.sizeBytes
        || head.checksumSha256 !== prepared.sha256Base64
      ) throw new Error('TENANT_EXPORT_OBJECT_VERIFICATION_FAILED');

      const published = await withTenantTransaction(this.prisma, job.tenantId, (transaction) =>
        transaction.tenantLifecycleRequest.updateMany({
          where: { id: job.requestId, tenantId: job.tenantId, status: 'EXPORTING', leaseId },
          data: {
            status: 'EXPORT_READY',
            exportObjectKey: objectKey,
            exportSha256: prepared.sha256Hex,
            exportSizeBytes: BigInt(prepared.sizeBytes),
            exportManifestVersion: prepared.manifestVersion,
            exportReadyAt: this.now(),
            exportExpiresAt: new Date(this.now().getTime() + ARTIFACT_TTL_MS),
            leaseId: null,
            leaseExpiresAt: null,
            lastErrorCode: null,
          },
        }));
      if (published.count === 0) {
        await this.storage.delete(objectKey);
        return 'IGNORED';
      }
      return 'EXPORT_READY';
    } catch (error) {
      if (uploaded) await safelyDelete(this.storage, objectKey);
      await this.fail(job, leaseId, attemptCount, error);
      return 'FAILED';
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async claim(job: TenantLifecycleJob, leaseId: string, now: Date): Promise<number | null> {
    return withTenantTransaction(this.prisma, job.tenantId, async (transaction) => {
      const claimed = await transaction.tenantLifecycleRequest.updateMany({
        where: {
          id: job.requestId,
          tenantId: job.tenantId,
          kind: 'EXPORT',
          OR: [
            { status: { in: ['REQUESTED', 'FAILED'] }, nextAttemptAt: { lte: now } },
            { status: 'EXPORTING', leaseExpiresAt: { lte: now } },
          ],
        },
        data: {
          status: 'EXPORTING',
          leaseId,
          leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
          attemptCount: { increment: 1 },
          lastErrorCode: null,
        },
      });
      if (claimed.count === 0) return null;
      const request = await transaction.tenantLifecycleRequest.findFirstOrThrow({
        where: { id: job.requestId, tenantId: job.tenantId, leaseId },
        select: { attemptCount: true },
      });
      return request.attemptCount;
    });
  }

  private async fail(job: TenantLifecycleJob, leaseId: string, attemptCount: number, error: unknown): Promise<void> {
    const now = this.now();
    const retryMs = Math.min(30_000 * 2 ** Math.max(0, attemptCount - 1), MAX_RETRY_MS);
    await withTenantTransaction(this.prisma, job.tenantId, (transaction) =>
      transaction.tenantLifecycleRequest.updateMany({
        where: { id: job.requestId, tenantId: job.tenantId, status: 'EXPORTING', leaseId },
        data: {
          status: 'FAILED',
          leaseId: null,
          leaseExpiresAt: null,
          nextAttemptAt: new Date(now.getTime() + retryMs),
          lastErrorCode: safeErrorCode(error),
        },
      }));
  }
}

function safeErrorCode(error: unknown): string {
  if (error instanceof Error && error.message === 'TENANT_EXPORT_OBJECT_VERIFICATION_FAILED') return error.message;
  return 'TENANT_EXPORT_FAILED';
}

async function safelyDelete(storage: Pick<StreamingObjectStorage, 'delete'>, key: string): Promise<void> {
  try {
    await storage.delete(key);
  } catch {
    // Reconciliation will retry the lifecycle request; never replace the bounded error with provider details.
  }
}
