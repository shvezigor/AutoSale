import type { ObjectStorage } from '@autosale/integrations';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MediaCopyError, MediaCopyService } from './media-copy.service.js';

describe('MediaCopyService', () => {
  const put = vi.fn();
  const fetchMedia = vi.fn();
  const storage: ObjectStorage = { put, get: vi.fn(), delete: vi.fn() };

  beforeEach(() => {
    put.mockReset().mockResolvedValue({ key: 'stored-key', etag: 'etag-1' });
    fetchMedia.mockReset();
  });

  it('copies an allowed image to a tenant-scoped content-addressed key', async () => {
    fetchMedia.mockResolvedValue(
      new Response(Uint8Array.from([1, 2, 3]), {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' },
      }),
    );
    const service = new MediaCopyService(storage, fetchMedia, {
      maxBytes: 1024,
      timeoutMs: 2500,
    });

    const result = await service.copy({
      tenantId: 'tenant-1',
      sourceUrl: 'https://example.test/image.jpg',
    });

    expect(fetchMedia).toHaveBeenCalledWith(
      'https://example.test/image.jpg',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(put).toHaveBeenCalledWith({
      key: expect.stringMatching(/^tenants\/tenant-1\/instagram\/sha256\//),
      body: expect.any(Uint8Array),
      contentType: 'image/jpeg',
    });
    expect(result).toEqual(
      expect.objectContaining({ checksum: expect.stringMatching(/^[a-f\d]{64}$/) }),
    );
  });

  it('rejects a response that exceeds the byte ceiling', async () => {
    fetchMedia.mockResolvedValue(
      new Response(Uint8Array.from([1, 2, 3, 4]), {
        headers: { 'Content-Type': 'image/png' },
      }),
    );
    const service = new MediaCopyService(storage, fetchMedia, { maxBytes: 3, timeoutMs: 100 });

    await expect(
      service.copy({ tenantId: 'tenant-1', sourceUrl: 'https://example.test/large.png' }),
    ).rejects.toMatchObject({ code: 'TOO_LARGE', retryable: false });
    expect(put).not.toHaveBeenCalled();
  });

  it('rejects MIME types outside the allowlist', async () => {
    fetchMedia.mockResolvedValue(
      new Response('not an image', { headers: { 'Content-Type': 'text/html' } }),
    );
    const service = new MediaCopyService(storage, fetchMedia);

    await expect(
      service.copy({ tenantId: 'tenant-1', sourceUrl: 'https://example.test/page' }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE', retryable: false });
  });

  it('derives the same checksum and key for identical bytes', async () => {
    fetchMedia.mockImplementation(async () =>
      new Response(Uint8Array.from([9, 8, 7]), {
        headers: { 'Content-Type': 'image/webp' },
      }),
    );
    put.mockImplementation(async (input: { key: string }) => ({ key: input.key, etag: 'etag' }));
    const service = new MediaCopyService(storage, fetchMedia);

    const first = await service.copy({ tenantId: 'tenant-1', sourceUrl: 'https://a.test/a' });
    const second = await service.copy({ tenantId: 'tenant-1', sourceUrl: 'https://a.test/b' });

    expect(second.checksum).toBe(first.checksum);
    expect(second.key).toBe(first.key);
  });

  it('classifies upstream and timeout failures as retryable', async () => {
    fetchMedia.mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    const service = new MediaCopyService(storage, fetchMedia, { timeoutMs: 1 });

    const error = await service
      .copy({ tenantId: 'tenant-1', sourceUrl: 'https://example.test/slow' })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(MediaCopyError);
    expect(error).toMatchObject({ code: 'UPSTREAM_FAILURE', retryable: true });
  });
});
