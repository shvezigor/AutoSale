import type { ObjectStorage } from '@autosale/integrations';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  InstagramAvatarCopyService,
  type PinnedAvatarResponse,
} from './instagram-avatar-copy.service.js';

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const LEASE_ID = '11111111-1111-4111-8111-111111111111';

describe('InstagramAvatarCopyService', () => {
  const put = vi.fn();
  const resolveHost = vi.fn();
  const requestPinned = vi.fn();
  const storage: ObjectStorage = { put, get: vi.fn(), delete: vi.fn() };

  beforeEach(() => {
    put.mockReset().mockImplementation(async (input: { key: string }) => ({
      key: input.key,
      etag: 'etag-1',
    }));
    resolveHost.mockReset().mockResolvedValue([{ address: '157.240.1.10', family: 4 }]);
    requestPinned.mockReset().mockResolvedValue(imageResponse(JPEG, 'image/jpeg'));
  });

  it('pins an allowlisted HTTPS avatar to a public resolved address before storing it', async () => {
    const service = new InstagramAvatarCopyService(storage, {
      resolveHost,
      requestPinned,
      maxBytes: 1024,
    });

    await expect(service.copy({
      tenantId: 'tenant-a',
      profileId: 'profile-a',
      refreshVersion: 7,
      leaseId: LEASE_ID,
      sourceUrl: 'https://scontent.cdninstagram.com/v/avatar.jpg?sig=opaque',
    })).resolves.toMatchObject({
      checksum: expect.stringMatching(/^[a-f\d]{64}$/),
      contentType: 'image/jpeg',
    });

    expect(resolveHost).toHaveBeenCalledWith('scontent.cdninstagram.com');
    expect(requestPinned).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: 'scontent.cdninstagram.com' }),
      { address: '157.240.1.10', family: 4 },
      expect.any(AbortSignal),
    );
    expect(put).toHaveBeenCalledWith({
      key: expect.stringMatching(new RegExp(`^tenants/tenant-a/instagram/profiles/profile-a/versions/7/leases/${LEASE_ID}/sha256/[a-f\\d]{64}\\.jpg$`)),
      body: JPEG,
      contentType: 'image/jpeg',
    });
  });

  it.each([
    'http://scontent.cdninstagram.com/avatar.jpg',
    'https://127.0.0.1/avatar.jpg',
    'https://cdninstagram.com.attacker.test/avatar.jpg',
  ])('rejects a malicious avatar URL before DNS or HTTP (%s)', async (sourceUrl) => {
    const service = new InstagramAvatarCopyService(storage, { resolveHost, requestPinned });

    await expect(service.copy({ tenantId: 'tenant-a', profileId: 'profile-a', refreshVersion: 1, leaseId: LEASE_ID, sourceUrl }))
      .rejects.toMatchObject({ code: 'UNSAFE_AVATAR_URL', retryable: false });
    expect(resolveHost).not.toHaveBeenCalled();
    expect(requestPinned).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('rejects DNS rebinding when any answer is private and never opens a socket', async () => {
    resolveHost.mockResolvedValue([
      { address: '157.240.1.10', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    const service = new InstagramAvatarCopyService(storage, { resolveHost, requestPinned });

    await expect(service.copy({
      tenantId: 'tenant-a',
      profileId: 'profile-a',
      refreshVersion: 1,
      leaseId: LEASE_ID,
      sourceUrl: 'https://platform-lookaside.fbsbx.com/avatar.jpg',
    })).rejects.toMatchObject({ code: 'UNSAFE_AVATAR_ADDRESS', retryable: false });
    expect(requestPinned).not.toHaveBeenCalled();
  });

  it('rejects oversized or falsely labelled avatar bodies before object storage', async () => {
    requestPinned.mockResolvedValueOnce(imageResponse(Uint8Array.from([1, 2, 3, 4]), 'image/png'));
    const service = new InstagramAvatarCopyService(storage, {
      resolveHost,
      requestPinned,
      maxBytes: 3,
    });

    await expect(service.copy({
      tenantId: 'tenant-a',
      profileId: 'profile-a',
      refreshVersion: 1,
      leaseId: LEASE_ID,
      sourceUrl: 'https://scontent.fbcdn.net/avatar.png',
    })).rejects.toMatchObject({ code: 'AVATAR_TOO_LARGE', retryable: false });
    expect(put).not.toHaveBeenCalled();
  });

  it('rejects an invalid lease id before DNS, HTTP, or object storage', async () => {
    const service = new InstagramAvatarCopyService(storage, { resolveHost, requestPinned });

    await expect(service.copy({
      tenantId: 'tenant-a',
      profileId: 'profile-a',
      refreshVersion: 1,
      leaseId: '../../winner',
      sourceUrl: 'https://scontent.fbcdn.net/avatar.jpg',
    })).rejects.toMatchObject({ code: 'INVALID_AVATAR_LEASE_ID', retryable: false });
    expect(resolveHost).not.toHaveBeenCalled();
    expect(requestPinned).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
});

function imageResponse(body: Uint8Array, contentType: string): PinnedAvatarResponse {
  return {
    status: 200,
    headers: { 'content-type': contentType },
    body: (async function* () { yield body; })(),
  };
}
