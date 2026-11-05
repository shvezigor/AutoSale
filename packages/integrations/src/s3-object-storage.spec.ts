import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { S3ObjectStorage } from './s3-object-storage.js';

const config = {
  endpoint: 'https://objects.example.test',
  region: 'eu-central-1',
  bucket: 'fictional-private-bucket',
  accessKeyId: 'fictional-access-key',
  secretAccessKey: 'fictional-secret-key',
  forcePathStyle: true,
};

describe('S3ObjectStorage', () => {
  it('streams a checksummed private object and reads its metadata without buffering the download', async () => {
    const bytes = Buffer.from('fictional lifecycle archive');
    const checksumSha256 = createHash('sha256').update(bytes).digest('base64');
    const body = Readable.from(bytes);
    const send = vi.fn()
      .mockResolvedValueOnce({ ETag: '"fictional-etag"' })
      .mockResolvedValueOnce({ Body: Readable.from(bytes), ContentType: 'application/zip', ContentLength: bytes.byteLength })
      .mockResolvedValueOnce({ ContentType: 'application/zip', ContentLength: bytes.byteLength, ChecksumSHA256: checksumSha256 });
    const sign = vi.fn().mockResolvedValue('https://objects.example.test/private-download?signature=fictional');
    const storage = new S3ObjectStorage(config, { client: { send }, sign } as never);

    await expect(storage.putStream({
      key: 'tenant-lifecycle/fictional/export.zip',
      body,
      contentType: 'application/zip',
      contentLength: bytes.byteLength,
      checksumSha256,
    })).resolves.toEqual({ key: 'tenant-lifecycle/fictional/export.zip', etag: 'fictional-etag' });

    const streamed = await storage.getStream('tenant-lifecycle/fictional/export.zip');
    expect(streamed).toEqual(expect.objectContaining({
      body: expect.any(Readable), contentType: 'application/zip', contentLength: bytes.byteLength,
    }));
    await expect(storage.head('tenant-lifecycle/fictional/export.zip')).resolves.toEqual({
      contentType: 'application/zip', contentLength: bytes.byteLength, checksumSha256,
    });
    expect(send.mock.calls[2]![0].input).toEqual(expect.objectContaining({
      Bucket: config.bucket,
      Key: 'tenant-lifecycle/fictional/export.zip',
      ChecksumMode: 'ENABLED',
    }));
    await expect(storage.createSignedDownloadUrl('tenant-lifecycle/fictional/export.zip', 300))
      .resolves.toMatch(/^https:/);

    expect(send.mock.calls[0]![0].input).toEqual(expect.objectContaining({
      Bucket: config.bucket,
      Key: 'tenant-lifecycle/fictional/export.zip',
      Body: body,
      ContentType: 'application/zip',
      ContentLength: bytes.byteLength,
      ChecksumSHA256: checksumSha256,
    }));
    expect(sign).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      input: { Bucket: config.bucket, Key: 'tenant-lifecycle/fictional/export.zip' },
    }), { expiresIn: 300 });
  });

  it('rejects signed URL lifetimes outside the bounded window', async () => {
    const storage = new S3ObjectStorage(config, { client: { send: vi.fn() }, sign: vi.fn() } as never);
    await expect(storage.createSignedDownloadUrl('tenant-lifecycle/fictional/export.zip', 59))
      .rejects.toThrow('SIGNED_URL_EXPIRY_INVALID');
    await expect(storage.createSignedDownloadUrl('tenant-lifecycle/fictional/export.zip', 601))
      .rejects.toThrow('SIGNED_URL_EXPIRY_INVALID');
  });

  const tenantId = '10000000-0000-4000-8000-000000000001';
  const otherTenantId = '20000000-0000-4000-8000-000000000002';

  it('inventories every tenant-owned prefix, all object versions and delete markers across pages', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({ Status: 'Enabled' })
      .mockResolvedValueOnce({
        Versions: [{ Key: `tenants/${tenantId}/instagram/sha256/fictional.jpg`, VersionId: 'v2', Size: 20 }],
        DeleteMarkers: [{ Key: `tenants/${tenantId}/instagram/sha256/fictional.jpg`, VersionId: 'marker-1' }],
        IsTruncated: true, NextKeyMarker: `tenants/${tenantId}/instagram/sha256/fictional.jpg`, NextVersionIdMarker: 'v2',
      })
      .mockResolvedValueOnce({
        Versions: [{ Key: `tenants/${tenantId}/instagram/sha256/fictional.jpg`, VersionId: 'v1', Size: 10 }],
        IsTruncated: false,
      })
      .mockResolvedValueOnce({ Versions: [{ Key: `catalogue/${tenantId}/fictional.csv`, VersionId: 'csv-v1', Size: 4 }], IsTruncated: false })
      .mockResolvedValueOnce({ DeleteMarkers: [{ Key: `tenant-lifecycle/${tenantId}/fictional.zip`, VersionId: 'zip-marker' }], IsTruncated: false });
    const storage = new S3ObjectStorage(config, { client: { send } } as never);
    const inventory = [];
    for await (const entry of storage.listTenantObjectVersions(tenantId)) inventory.push(entry);

    expect(inventory).toEqual([
      { key: `tenants/${tenantId}/instagram/sha256/fictional.jpg`, versionId: 'v2', kind: 'object', sizeBytes: 20 },
      { key: `tenants/${tenantId}/instagram/sha256/fictional.jpg`, versionId: 'marker-1', kind: 'delete-marker', sizeBytes: null },
      { key: `tenants/${tenantId}/instagram/sha256/fictional.jpg`, versionId: 'v1', kind: 'object', sizeBytes: 10 },
      { key: `catalogue/${tenantId}/fictional.csv`, versionId: 'csv-v1', kind: 'object', sizeBytes: 4 },
      { key: `tenant-lifecycle/${tenantId}/fictional.zip`, versionId: 'zip-marker', kind: 'delete-marker', sizeBytes: null },
    ]);
    expect(send.mock.calls.slice(1).map(([command]) => command.input.Prefix)).toEqual([
      `tenants/${tenantId}/`, `tenants/${tenantId}/`, `catalogue/${tenantId}/`, `tenant-lifecycle/${tenantId}/`,
    ]);
    expect(send.mock.calls[2]![0].input).toEqual(expect.objectContaining({
      KeyMarker: `tenants/${tenantId}/instagram/sha256/fictional.jpg`, VersionIdMarker: 'v2', MaxKeys: 1_000,
    }));
  });

  it('inventories and idempotently deletes unversioned tenant objects with exact scope', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Contents: [{ Key: `tenants/${tenantId}/tiktok/fictional.jpg`, Size: 9 }], IsTruncated: false })
      .mockResolvedValueOnce({ Contents: [], IsTruncated: false })
      .mockResolvedValueOnce({ Contents: [], IsTruncated: false })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const storage = new S3ObjectStorage(config, { client: { send } } as never);
    const inventory = [];
    for await (const entry of storage.listTenantObjectVersions(tenantId)) inventory.push(entry);
    expect(inventory).toEqual([{ key: `tenants/${tenantId}/tiktok/fictional.jpg`, versionId: null, kind: 'object', sizeBytes: 9 }]);
    await storage.deleteTenantObjectVersion(tenantId, inventory[0]!);
    await storage.deleteTenantObjectVersion(tenantId, inventory[0]!);
    expect(send.mock.calls.slice(-4).map(([command]) => command.constructor.name)).toEqual([
      'GetBucketVersioningCommand', 'DeleteObjectCommand', 'GetBucketVersioningCommand', 'DeleteObjectCommand',
    ]);
    expect(send.mock.calls.at(-1)![0].input).toEqual({ Bucket: config.bucket, Key: inventory[0]!.key });
  });

  it('paginates an unversioned inventory and rejects a stalled continuation token', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        Contents: [{ Key: `tenants/${tenantId}/fictional-1.jpg`, Size: 1 }],
        IsTruncated: true, NextContinuationToken: 'next-page',
      })
      .mockResolvedValueOnce({
        Contents: [{ Key: `tenants/${tenantId}/fictional-2.jpg`, Size: 2 }],
        IsTruncated: true, NextContinuationToken: 'next-page',
      });
    const storage = new S3ObjectStorage(config, { client: { send } } as never);
    await expect(async () => {
      for await (const _entry of storage.listTenantObjectVersions(tenantId)) { /* consume */ }
    }).rejects.toThrow('TENANT_OBJECT_INVENTORY_CURSOR_INVALID');
    expect(send.mock.calls[2]![0].input).toEqual(expect.objectContaining({
      Prefix: `tenants/${tenantId}/`, ContinuationToken: 'next-page',
    }));
  });

  it('rejects a two-token cycle in unversioned inventory pagination', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ IsTruncated: true, NextContinuationToken: 'cursor-a' })
      .mockResolvedValueOnce({ IsTruncated: true, NextContinuationToken: 'cursor-b' })
      .mockResolvedValueOnce({ IsTruncated: true, NextContinuationToken: 'cursor-a' });
    const storage = new S3ObjectStorage(config, { client: { send } } as never);
    await expect(async () => {
      for await (const _entry of storage.listTenantObjectVersions(tenantId)) { /* consume */ }
    }).rejects.toThrow('TENANT_OBJECT_INVENTORY_CURSOR_INVALID');
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('rejects a two-marker cycle in versioned inventory pagination', async () => {
    const markerA = `tenants/${tenantId}/cursor-a`;
    const markerB = `tenants/${tenantId}/cursor-b`;
    const send = vi.fn()
      .mockResolvedValueOnce({ Status: 'Enabled' })
      .mockResolvedValueOnce({ IsTruncated: true, NextKeyMarker: markerA, NextVersionIdMarker: 'v1' })
      .mockResolvedValueOnce({ IsTruncated: true, NextKeyMarker: markerB, NextVersionIdMarker: 'v2' })
      .mockResolvedValueOnce({ IsTruncated: true, NextKeyMarker: markerA, NextVersionIdMarker: 'v1' });
    const storage = new S3ObjectStorage(config, { client: { send } } as never);
    await expect(async () => {
      for await (const _entry of storage.listTenantObjectVersions(tenantId)) { /* consume */ }
    }).rejects.toThrow('TENANT_OBJECT_INVENTORY_CURSOR_INVALID');
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('deletes a specific historical version or delete marker without a new marker', async () => {
    const send = vi.fn().mockResolvedValue({});
    const storage = new S3ObjectStorage(config, { client: { send } } as never);
    await storage.deleteTenantObjectVersion(tenantId, {
      key: `catalogue/${tenantId}/fictional.csv`, versionId: 'history-v1', kind: 'object', sizeBytes: 4,
    });
    await storage.deleteTenantObjectVersion(tenantId, {
      key: `tenant-lifecycle/${tenantId}/fictional.zip`, versionId: 'marker-v1', kind: 'delete-marker', sizeBytes: null,
    });
    expect(send.mock.calls.map(([command]) => command.input)).toEqual([
      { Bucket: config.bucket, Key: `catalogue/${tenantId}/fictional.csv`, VersionId: 'history-v1' },
      { Bucket: config.bucket, Key: `tenant-lifecycle/${tenantId}/fictional.zip`, VersionId: 'marker-v1' },
    ]);
  });

  it('treats the literal null version id in a suspended bucket as an explicit version', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({ Status: 'Suspended' })
      .mockResolvedValueOnce({ Versions: [{ Key: `tenants/${tenantId}/fictional.jpg`, VersionId: 'null', Size: 1 }], IsTruncated: false })
      .mockResolvedValueOnce({ Versions: [], IsTruncated: false })
      .mockResolvedValueOnce({ Versions: [], IsTruncated: false })
      .mockResolvedValueOnce({});
    const storage = new S3ObjectStorage(config, { client: { send } } as never);
    const inventory = [];
    for await (const entry of storage.listTenantObjectVersions(tenantId)) inventory.push(entry);
    expect(inventory).toEqual([{ key: `tenants/${tenantId}/fictional.jpg`, versionId: 'null', kind: 'object', sizeBytes: 1 }]);
    await storage.deleteTenantObjectVersion(tenantId, inventory[0]!);
    expect(send.mock.calls.at(-1)![0].input).toEqual({
      Bucket: config.bucket, Key: `tenants/${tenantId}/fictional.jpg`, VersionId: 'null',
    });
  });

  it('accepts an already-missing version on replay but never masks an access failure', async () => {
    const missing = new Error('already removed');
    missing.name = 'NoSuchVersion';
    const denied = new Error('not permitted');
    denied.name = 'AccessDenied';
    const send = vi.fn().mockRejectedValueOnce(missing).mockRejectedValueOnce(denied);
    const storage = new S3ObjectStorage(config, { client: { send } } as never);
    const object = { key: `tenants/${tenantId}/fictional.jpg`, versionId: 'v1', kind: 'object' as const, sizeBytes: 1 };
    await expect(storage.deleteTenantObjectVersion(tenantId, object)).resolves.toBeUndefined();
    await expect(storage.deleteTenantObjectVersion(tenantId, object)).rejects.toBe(denied);
  });

  it('rejects cross-tenant keys, invalid tenant ids, changed versioning and malformed listing cursors', async () => {
    const send = vi.fn();
    const storage = new S3ObjectStorage(config, { client: { send } } as never);
    await expect(storage.deleteTenantObjectVersion(tenantId, {
      key: `tenants/${otherTenantId}/fictional.jpg`, versionId: 'v1', kind: 'object', sizeBytes: 1,
    })).rejects.toThrow('TENANT_OBJECT_INVENTORY_SCOPE_INVALID');
    await expect(storage.deleteTenantObjectVersion('../other', {
      key: `tenants/${tenantId}/fictional.jpg`, versionId: 'v1', kind: 'object', sizeBytes: 1,
    })).rejects.toThrow('TENANT_OBJECT_ID_INVALID');
    expect(send).not.toHaveBeenCalled();

    const upperCaseId = 'AAAAAAAA-0000-4000-8000-000000000001';
    await expect(async () => {
      for await (const _entry of storage.listTenantObjectVersions(upperCaseId)) { /* consume */ }
    }).rejects.toThrow('TENANT_OBJECT_ID_INVALID');
    await expect(storage.deleteTenantObjectVersion(upperCaseId, {
      key: 'tenants/aaaaaaaa-0000-4000-8000-000000000001/fictional.jpg',
      versionId: 'v1', kind: 'object', sizeBytes: 1,
    })).rejects.toThrow('TENANT_OBJECT_ID_INVALID');
    expect(send).not.toHaveBeenCalled();

    send.mockResolvedValueOnce({ Status: 'Enabled' });
    await expect(storage.deleteTenantObjectVersion(tenantId, {
      key: `tenants/${tenantId}/fictional.jpg`, versionId: null, kind: 'object', sizeBytes: 1,
    })).rejects.toThrow('TENANT_OBJECT_VERSIONING_CHANGED');
    expect(send).toHaveBeenCalledTimes(1);

    send.mockResolvedValueOnce({ Status: 'Enabled' }).mockResolvedValueOnce({ IsTruncated: true });
    await expect(async () => {
      for await (const _entry of storage.listTenantObjectVersions(tenantId)) { /* consume */ }
    }).rejects.toThrow('TENANT_OBJECT_INVENTORY_CURSOR_INVALID');
  });

  it('rejects provider listing results outside the requested tenant prefix', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({ Status: 'Enabled' })
      .mockResolvedValueOnce({ Versions: [{ Key: `tenants/${otherTenantId}/fictional.jpg`, VersionId: 'v1' }] });
    const storage = new S3ObjectStorage(config, { client: { send } } as never);
    await expect(async () => {
      for await (const _entry of storage.listTenantObjectVersions(tenantId)) { /* consume */ }
    }).rejects.toThrow('TENANT_OBJECT_INVENTORY_SCOPE_INVALID');
  });

  it('fails closed on an unknown versioning state', async () => {
    const send = vi.fn().mockResolvedValue({ Status: 'Unexpected' });
    const storage = new S3ObjectStorage(config, { client: { send } } as never);
    await expect(async () => {
      for await (const _entry of storage.listTenantObjectVersions(tenantId)) { /* consume */ }
    }).rejects.toThrow('TENANT_OBJECT_VERSIONING_UNKNOWN');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['versioned', { Status: 'Enabled' }, { Versions: [] }],
    ['unversioned', {}, { Contents: [] }],
  ])('rejects a %s inventory page without an explicit IsTruncated flag', async (_mode, versioning, page) => {
    const send = vi.fn().mockResolvedValueOnce(versioning).mockResolvedValueOnce(page);
    const storage = new S3ObjectStorage(config, { client: { send } } as never);
    await expect(async () => {
      for await (const _entry of storage.listTenantObjectVersions(tenantId)) { /* consume */ }
    }).rejects.toThrow('TENANT_OBJECT_INVENTORY_PAGE_INVALID');
    expect(send).toHaveBeenCalledTimes(2);
  });
});
