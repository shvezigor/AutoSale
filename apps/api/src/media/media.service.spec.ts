import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { MediaService } from './media.service.js';

describe('MediaService', () => {
  it('scopes attachment lookup through the message tenant and hides foreign ids', async () => {
    let query: unknown;
    const prisma = { attachment: { findFirst: async (input: unknown) => { query = input; return null; } } };
    const service = new MediaService(prisma as never, {} as never);

    await expect(service.load('tenant-b', '11111111-1111-4111-8111-111111111111'))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(query).toEqual(expect.objectContaining({
      where: expect.objectContaining({ message: { tenantId: 'tenant-b' } }),
    }));
  });

  it('scopes cached Instagram avatars by both tenant and profile id', async () => {
    let query: unknown;
    const prisma = {
      instagramCustomerProfile: {
        findFirst: async (input: unknown) => {
          query = input;
          return { avatarStorageKey: 'tenants/tenant-a/profile/avatar.jpg' };
        },
      },
    };
    const get = async () => ({ body: Uint8Array.from([1]), contentType: 'image/jpeg' });
    const service = new MediaService(prisma as never, { get } as never);

    await expect(service.loadProfileAvatar('tenant-a', '11111111-1111-4111-8111-111111111111'))
      .resolves.toMatchObject({ contentType: 'image/jpeg' });
    expect(query).toEqual({
      where: {
        id: '11111111-1111-4111-8111-111111111111',
        tenantId: 'tenant-a',
        avatarStorageKey: { not: null },
      },
      select: { avatarStorageKey: true },
    });
  });
});
