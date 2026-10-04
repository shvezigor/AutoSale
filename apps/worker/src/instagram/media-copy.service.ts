import { createHash } from 'node:crypto';

import type { ObjectStorage } from '@autosale/integrations';

import type { SocialChannel } from '../social/normalized-inbound-message.js';

const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_VIDEO_BYTES = 25 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const MIME_EXTENSIONS = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['video/mp4', 'mp4'],
]);

type FetchMedia = (url: string, init: RequestInit) => Promise<Response>;

export class MediaCopyError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'MediaCopyError';
  }
}

export class MediaCopyService {
  private readonly maxImageBytes: number;
  private readonly maxVideoBytes: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly storage: ObjectStorage,
    private readonly fetchMedia: FetchMedia = fetch,
    options: { maxBytes?: number; maxVideoBytes?: number; timeoutMs?: number } = {},
  ) {
    this.maxImageBytes = options.maxBytes ?? DEFAULT_MAX_IMAGE_BYTES;
    this.maxVideoBytes = options.maxVideoBytes ?? DEFAULT_MAX_VIDEO_BYTES;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async copy(input: { tenantId: string; sourceUrl: string; channel?: SocialChannel }): Promise<{
    key: string;
    etag: string;
    checksum: string;
    contentType: string;
  }> {
    try {
      const response = await this.fetchMedia(input.sourceUrl, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        throw new MediaCopyError(
          'UPSTREAM_HTTP',
          response.status === 429 || response.status >= 500,
          `Media provider returned HTTP ${response.status}`,
        );
      }

      const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
      const extension = contentType ? MIME_EXTENSIONS.get(contentType) : undefined;
      if (!contentType || !extension) {
        throw new MediaCopyError(
          'UNSUPPORTED_MEDIA_TYPE',
          false,
          `Unsupported media type: ${contentType ?? 'missing'}`,
        );
      }

      const maxBytes = contentType === 'video/mp4' ? this.maxVideoBytes : this.maxImageBytes;
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        throw new MediaCopyError('TOO_LARGE', false, `Media exceeds the configured ${maxBytes} byte ceiling`);
      }

      const body = await readWithLimit(response, maxBytes);
      const checksum = createHash('sha256').update(body).digest('hex');
      const provider = input.channel === 'FACEBOOK'
        ? 'facebook'
        : input.channel === 'TIKTOK'
          ? 'tiktok'
          : 'instagram';
      const key = `tenants/${input.tenantId}/${provider}/sha256/${checksum}.${extension}`;
      const stored = await this.storage.put({ key, body, contentType });

      return { ...stored, checksum, contentType };
    } catch (error) {
      if (error instanceof MediaCopyError) throw error;
      throw new MediaCopyError('UPSTREAM_FAILURE', true, 'Unable to copy media', { cause: error });
    }
  }
}

async function readWithLimit(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new MediaCopyError('TOO_LARGE', false, `Media exceeds the configured ${maxBytes} byte ceiling`);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
