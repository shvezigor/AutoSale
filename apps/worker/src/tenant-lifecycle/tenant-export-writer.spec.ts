import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { inflateRawSync } from 'node:zlib';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TenantExportDataset } from './tenant-export-datasets.js';
import { writeTenantExport } from './tenant-export-writer.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const snapshotAt = new Date('2026-10-02T09:00:00.000Z');
const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('writeTenantExport', () => {
  it('writes a deterministic redacted archive and checksums referenced objects', async () => {
    const dataset: TenantExportDataset = {
      name: 'instagram-connections',
      fields: ['id', 'externalAccountId', 'status', 'createdAt'],
      page: vi.fn(async (_tx, _tenant, afterId) => afterId ? [] : [{
        id: '33333333-3333-4333-8333-333333333333',
        externalAccountId: '17841400000000000',
        status: 'ACTIVE',
        createdAt: '2026-10-02T08:00:00.000Z',
      }]),
    };
    const objectBytes = Buffer.from('fictional avatar bytes');
    const storage = {
      getStream: vi.fn().mockImplementation(async () => ({
        body: Readable.from(objectBytes), contentType: 'image/jpeg', contentLength: objectBytes.byteLength,
      })),
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (tx: unknown) => Promise<unknown>) => operation({ $queryRaw: vi.fn() })),
    };
    const firstRoot = await temporaryRoot();
    const secondRoot = await temporaryRoot();
    const input = {
      prisma: prisma as never,
      storage: storage as never,
      tenantId,
      requestId,
      snapshotAt,
      datasets: [dataset],
      objectReferences: [{ key: 'avatars/fictional.jpg', purpose: 'customer_avatar' as const }],
    };

    const first = await writeTenantExport({ ...input, directory: firstRoot });
    const second = await writeTenantExport({ ...input, directory: secondRoot });

    expect(second.sha256Hex).toBe(first.sha256Hex);
    expect(first.sizeBytes).toBeGreaterThan(0);
    expect(first.datasetCounts).toEqual({ 'instagram-connections': 1 });
    expect(first.objectCount).toBe(1);

    const row = JSON.parse(readZipText(await readFile(first.archivePath), 'data/instagram-connections.jsonl').trim());
    expect(row).not.toHaveProperty('encryptedAccessToken');
    const manifest = JSON.parse(readZipText(await readFile(first.archivePath), 'manifest.json'));
    expect(manifest).toEqual(expect.objectContaining({
      manifestVersion: 1,
      tenantId,
      requestId,
      excludedCategories: expect.arrayContaining(['provider_credentials', 'sessions', 'password_hashes']),
    }));
    const objectManifest = JSON.parse(readZipText(await readFile(first.archivePath), 'objects/manifest.jsonl').trim());
    expect(objectManifest).toEqual(expect.objectContaining({
      key: 'avatars/fictional.jpg',
      purpose: 'customer_avatar',
      sizeBytes: objectBytes.byteLength,
      sha256: createHash('sha256').update(objectBytes).digest('hex'),
    }));
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sales-aito-export-test-'));
  roots.push(root);
  return root;
}

function readZipText(zip: Buffer, entryName: string): string {
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('ZIP_EOCD_NOT_FOUND');
  let offset = zip.readUInt32LE(eocd + 16);
  while (offset < eocd && zip.readUInt32LE(offset) === 0x02014b50) {
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (name === entryName) {
      const localNameLength = zip.readUInt16LE(localOffset + 26);
      const localExtraLength = zip.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = zip.subarray(start, start + compressedSize);
      if (method === 0) return compressed.toString('utf8');
      if (method === 8) return inflateRawSync(compressed).toString('utf8');
      throw new Error('ZIP_METHOD_UNSUPPORTED');
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`ZIP_ENTRY_NOT_FOUND:${entryName}`);
}
