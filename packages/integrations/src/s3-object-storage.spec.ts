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

describe('S3ObjectStorage lifecycle artifact support', () => {
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
});
