import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import type { PrismaClient, Prisma } from '@autosale/database';
import { withTenantTransaction } from '@autosale/database';
import type { StreamingObjectStorage } from '@autosale/integrations';
import archiver from 'archiver';

import {
  listTenantObjectReferences,
  TENANT_EXPORT_DATASETS,
  type TenantExportDataset,
  type TenantExportObjectReference,
} from './tenant-export-datasets.js';

const PAGE_SIZE = 500;
const ARCHIVE_DATE = new Date('1980-01-01T00:00:00.000Z');
const EXCLUDED_CATEGORIES = [
  'provider_credentials',
  'password_hashes',
  'sessions',
  'authentication_tokens',
  'oauth_state',
  'internal_leases',
  'platform_security_evidence',
] as const;

export type PreparedTenantExport = {
  archivePath: string;
  sha256Hex: string;
  sha256Base64: string;
  sizeBytes: number;
  manifestVersion: 1;
  datasetCounts: Record<string, number>;
  objectCount: number;
};

export type WriteTenantExportInput = {
  prisma: PrismaClient;
  storage: Pick<StreamingObjectStorage, 'getStream'>;
  tenantId: string;
  requestId: string;
  directory: string;
  snapshotAt: Date;
  datasets?: readonly TenantExportDataset[];
  objectReferences?: readonly TenantExportObjectReference[];
};

type PreparedFile = { archiveName: string; path: string; count?: number; sha256: string; sizeBytes: number };

export async function writeTenantExport(input: WriteTenantExportInput): Promise<PreparedTenantExport> {
  await mkdir(input.directory, { recursive: true });
  const workDirectory = await mkdtemp(join(input.directory, '.tenant-export-'));
  const archivePath = join(input.directory, `${input.requestId}.zip`);
  const datasets = [...(input.datasets ?? TENANT_EXPORT_DATASETS)].sort((left, right) => compareText(left.name, right.name));
  const preparedFiles: PreparedFile[] = [];
  const datasetCounts: Record<string, number> = {};
  let objectReferences: readonly TenantExportObjectReference[] = input.objectReferences ?? [];
  let succeeded = false;

  try {
    await withTenantTransaction(input.prisma, input.tenantId, async (transaction) => {
      const dataDirectory = join(workDirectory, 'data');
      await mkdir(dataDirectory, { recursive: true });
      for (const current of datasets) {
        const path = join(dataDirectory, `${current.name}.jsonl`);
        const count = await writeDataset(path, current, transaction, input.tenantId);
        datasetCounts[current.name] = count;
        preparedFiles.push({ archiveName: `data/${current.name}.jsonl`, path, count, ...await fileDigest(path) });
      }
      if (input.objectReferences === undefined) {
        objectReferences = await listTenantObjectReferences(transaction, input.tenantId);
      }
    }, { isolationLevel: 'RepeatableRead', timeout: 120_000 });

    const objectsDirectory = join(workDirectory, 'objects');
    await mkdir(objectsDirectory, { recursive: true });
    const objectManifestPath = join(objectsDirectory, 'manifest.jsonl');
    await writeObjectManifest(objectManifestPath, input.storage, objectReferences);
    preparedFiles.push({ archiveName: 'objects/manifest.jsonl', path: objectManifestPath, ...await fileDigest(objectManifestPath) });

    const manifestPath = join(workDirectory, 'manifest.json');
    await writeFile(manifestPath, `${stableJson({
      manifestVersion: 1,
      tenantId: input.tenantId,
      requestId: input.requestId,
      snapshotAt: input.snapshotAt.toISOString(),
      datasets: preparedFiles
        .filter((file) => file.archiveName.startsWith('data/'))
        .map((file) => ({ name: file.archiveName, count: file.count, sha256: file.sha256, sizeBytes: file.sizeBytes })),
      objectManifest: {
        name: 'objects/manifest.jsonl',
        count: objectReferences.length,
        sha256: preparedFiles.find((file) => file.archiveName === 'objects/manifest.jsonl')!.sha256,
        sizeBytes: preparedFiles.find((file) => file.archiveName === 'objects/manifest.jsonl')!.sizeBytes,
      },
      excludedCategories: EXCLUDED_CATEGORIES,
    })}\n`, 'utf8');
    preparedFiles.push({ archiveName: 'manifest.json', path: manifestPath, ...await fileDigest(manifestPath) });

    const readmePath = join(workDirectory, 'README.json');
    await writeFile(readmePath, `${stableJson({
      format: 'sales-aito-tenant-export',
      manifestVersion: 1,
      encoding: 'UTF-8 JSON Lines',
      binaryObjectsIncluded: false,
      excludedCategories: EXCLUDED_CATEGORIES,
    })}\n`, 'utf8');
    preparedFiles.push({ archiveName: 'README.json', path: readmePath, ...await fileDigest(readmePath) });

    await writeArchive(archivePath, preparedFiles);
    const archiveDigest = await fileDigest(archivePath);
    succeeded = true;
    return {
      archivePath,
      sha256Hex: archiveDigest.sha256,
      sha256Base64: archiveDigest.sha256Base64,
      sizeBytes: archiveDigest.sizeBytes,
      manifestVersion: 1,
      datasetCounts,
      objectCount: objectReferences.length,
    };
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
    if (!succeeded) await rm(archivePath, { force: true });
  }
}

async function writeDataset(
  path: string,
  dataset: TenantExportDataset,
  transaction: Prisma.TransactionClient,
  tenantId: string,
): Promise<number> {
  const handle = await open(path, 'w', 0o600);
  let afterId: string | null = null;
  let count = 0;
  try {
    while (true) {
      const rows = await dataset.page(transaction, tenantId, afterId, PAGE_SIZE);
      for (const row of rows) await handle.write(`${stableJson(row)}\n`);
      count += rows.length;
      if (rows.length < PAGE_SIZE) break;
      const nextId = rows.at(-1)?.id;
      if (typeof nextId !== 'string' || nextId === afterId) throw new Error(`TENANT_EXPORT_CURSOR_INVALID:${dataset.name}`);
      afterId = nextId;
    }
  } finally {
    await handle.close();
  }
  return count;
}

async function writeObjectManifest(
  path: string,
  storage: Pick<StreamingObjectStorage, 'getStream'>,
  references: readonly TenantExportObjectReference[],
): Promise<void> {
  const handle = await open(path, 'w', 0o600);
  try {
    for (const reference of [...references].sort((left, right) => compareText(left.key, right.key) || compareText(left.purpose, right.purpose))) {
      const stored = await storage.getStream(reference.key);
      const hash = createHash('sha256');
      let sizeBytes = 0;
      for await (const chunk of stored.body) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        hash.update(bytes);
        sizeBytes += bytes.byteLength;
      }
      if (sizeBytes !== stored.contentLength) throw new Error('TENANT_EXPORT_OBJECT_SIZE_MISMATCH');
      await handle.write(`${stableJson({
        key: reference.key,
        purpose: reference.purpose,
        contentType: stored.contentType,
        sizeBytes,
        sha256: hash.digest('hex'),
      })}\n`);
    }
  } finally {
    await handle.close();
  }
}

async function writeArchive(archivePath: string, files: readonly PreparedFile[]): Promise<void> {
  const archive = archiver('zip', { zlib: { level: 9 }, forceLocalTime: false });
  const output = createWriteStream(archivePath, { mode: 0o600 });
  const completion = pipeline(archive, output);
  for (const file of [...files].sort((left, right) => compareText(left.archiveName, right.archiveName))) {
    archive.append(createReadStream(file.path), { name: file.archiveName, date: ARCHIVE_DATE, mode: 0o600 });
  }
  await archive.finalize();
  await completion;
}

async function fileDigest(path: string): Promise<{ sha256: string; sha256Base64: string; sizeBytes: number }> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  const digest = hash.digest();
  return {
    sha256: digest.toString('hex'),
    sha256Base64: digest.toString('base64'),
    sizeBytes: (await stat(path)).size,
  };
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, nested]) => [key, sortValue(nested)]),
    );
  }
  return value instanceof Date ? value.toISOString() : value;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
