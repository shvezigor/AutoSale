import { createHash } from 'node:crypto';

import type { ObjectStorage, TikTokBusinessMessagingClient } from '@autosale/integrations';

import { MediaCopyError } from '../instagram/media-copy.service.js';
import type { SocialMediaCopier } from '../social/social-inbound-ingestion.service.js';
import { decodeTikTokMediaSource } from './tiktok-normalizer.js';
import type { TikTokTokenService } from './tiktok-token.service.js';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

export interface TikTokCredentialReference {
  externalAccountId: string;
  credentialGenerationId: string;
}

export class TikTokMediaCopyService implements SocialMediaCopier {
  constructor(
    private readonly storage: ObjectStorage,
    private readonly client: Pick<TikTokBusinessMessagingClient, 'downloadMedia'>,
    private readonly tokens: Pick<TikTokTokenService, 'getFreshAccessToken'>,
    private readonly resolveCredential: (tenantId: string) => Promise<TikTokCredentialReference | null>,
  ) {}

  async copy(input: { tenantId: string; sourceUrl: string }): Promise<{
    key: string; etag: string; checksum: string; contentType: string;
  }> {
    try {
      const reference = decodeTikTokMediaSource(input.sourceUrl);
      const credential = await this.resolveCredential(input.tenantId);
      if (!credential || credential.externalAccountId !== reference.accountId) {
        throw new MediaCopyError('CREDENTIAL_UNAVAILABLE', false, 'TikTok media credentials unavailable');
      }
      const accessToken = await this.tokens.getFreshAccessToken(
        input.tenantId,
        credential.credentialGenerationId,
        new Date(),
      );
      const downloaded = await this.client.downloadMedia(accessToken, reference);
      const maxBytes = reference.mediaType === 'IMAGE' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
      const body = await readWithLimit(downloaded.body, maxBytes);
      const checksum = createHash('sha256').update(body).digest('hex');
      const extension = downloaded.contentType === 'video/mp4'
        ? 'mp4'
        : downloaded.contentType === 'image/png' ? 'png' : 'jpg';
      const key = `tenants/${input.tenantId}/tiktok/sha256/${checksum}.${extension}`;
      const stored = await this.storage.put({ key, body, contentType: downloaded.contentType });
      return { ...stored, checksum, contentType: downloaded.contentType };
    } catch (error) {
      if (error instanceof MediaCopyError) throw error;
      throw new MediaCopyError('TIKTOK_MEDIA_FAILURE', true, 'Unable to copy TikTok media', { cause: error });
    }
  }
}

async function readWithLimit(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array> {
  const reader = stream.getReader();
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
