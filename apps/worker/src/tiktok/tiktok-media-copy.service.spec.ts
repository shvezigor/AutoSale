import type { ObjectStorage } from '@autosale/integrations';
import { describe, expect, it, vi } from 'vitest';

import { normalizeTikTokEvent } from './tiktok-normalizer.js';
import { TikTokMediaCopyService } from './tiktok-media-copy.service.js';

describe('TikTokMediaCopyService', () => {
  it('downloads with a fresh token and stores bytes under a controlled tenant key', async () => {
    const payload = {
      client_key: 'app', event: 'im_receive_msg', user_openid: 'business-1', create_time: 1,
      content: JSON.stringify({
        unique_identifier: 'customer', conversation_id: 'conversation-1', message_id: 'message-1',
        timestamp: 1_780_000_000_000, type: 'image', image: { media_id: 'media-1' },
      }),
    };
    const sourceUrl = normalizeTikTokEvent(payload)[0]!.attachments[0]!.sourceUrl;
    const put = vi.fn().mockImplementation(async ({ key }: { key: string }) => ({ key, etag: 'etag' }));
    const storage = { put, get: vi.fn(), delete: vi.fn() } as ObjectStorage;
    const downloadMedia = vi.fn().mockResolvedValue({
      body: new Response(Uint8Array.from([1, 2, 3])).body!, contentType: 'image/jpeg', contentLength: 3,
    });
    const getFreshAccessToken = vi.fn().mockResolvedValue('fresh-access');
    const service = new TikTokMediaCopyService(
      storage,
      { downloadMedia } as never,
      { getFreshAccessToken } as never,
      async () => ({ externalAccountId: 'business-1', credentialGenerationId: 'generation-1' }),
    );

    await expect(service.copy({ tenantId: 'tenant-1', sourceUrl })).resolves.toMatchObject({
      key: expect.stringMatching(/^tenants\/tenant-1\/tiktok\/sha256\/.+\.jpg$/),
      checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(getFreshAccessToken).toHaveBeenCalledWith('tenant-1', 'generation-1', expect.any(Date));
    expect(downloadMedia).toHaveBeenCalledWith('fresh-access', expect.objectContaining({ mediaId: 'media-1' }));
  });
});
