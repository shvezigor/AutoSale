import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { MediaService } from './media.service.js';

describe('MediaService', () => {
  it('scopes attachment lookup through the message tenant and hides foreign ids', async () => {
    let query: unknown;
    const transaction = {
      $queryRaw: async () => [{ set_config: '22222222-2222-4222-8222-222222222222' }],
      attachment: { findFirst: async (input: unknown) => { query = input; return null; } },
    };
    const prisma = { $transaction: async (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction) };
    const service = new MediaService(prisma as never, {} as never);

    await expect(service.load('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111'))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(query).toEqual(expect.objectContaining({
      where: expect.objectContaining({ message: { tenantId: '22222222-2222-4222-8222-222222222222' } }),
    }));
  });

  it('scopes cached Instagram avatars by both tenant and profile id', async () => {
    const tenantId = '22222222-2222-4222-8222-222222222222';
    let query: unknown;
    const transaction = {
      $queryRaw: async () => [{ set_config: tenantId }],
      instagramCustomerProfile: {
        findFirst: async (input: unknown) => {
          query = input;
          return { avatarStorageKey: `tenants/${tenantId}/profile/avatar.jpg` };
        },
      },
    };
    const prisma = { $transaction: async (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction) };
    const get = async () => ({ body: Uint8Array.from([1]), contentType: 'image/jpeg' });
    const service = new MediaService(prisma as never, { get } as never);

    await expect(service.loadProfileAvatar(tenantId, '11111111-1111-4111-8111-111111111111'))
      .resolves.toMatchObject({ contentType: 'image/jpeg' });
    expect(query).toEqual({
      where: {
        id: '11111111-1111-4111-8111-111111111111',
        tenantId,
        avatarStorageKey: { not: null },
      },
      select: { avatarStorageKey: true },
    });
  });

  it('loads only the current user controlled WebP avatar', async () => {
    let query: unknown;
    const prisma = { user: { findUnique: async (input: unknown) => {
      query = input;
      return { avatarStorageKey: 'users/user-a/avatars/avatar.webp' };
    } } };
    const storage = { get: async () => ({ body: Uint8Array.from([82, 73, 70, 70]), contentType: 'image/webp' }) };
    const service = new MediaService(prisma as never, storage as never);

    await expect(service.loadUserAvatar('user-a')).resolves.toMatchObject({ contentType: 'image/webp' });
    expect(query).toEqual({
      where: { id: 'user-a' },
      select: { avatarStorageKey: true },
    });
  });

  it('does not serve a missing or unexpectedly typed user avatar', async () => {
    const missing = new MediaService(
      { user: { findUnique: async () => ({ avatarStorageKey: null }) } } as never,
      { get: async () => ({ body: new Uint8Array(), contentType: 'image/webp' }) } as never,
    );
    await expect(missing.loadUserAvatar('user-a')).rejects.toBeInstanceOf(NotFoundException);

    const unexpectedType = new MediaService(
      { user: { findUnique: async () => ({ avatarStorageKey: 'users/user-a/avatars/avatar.webp' }) } } as never,
      { get: async () => ({ body: new Uint8Array(), contentType: 'text/html' }) } as never,
    );
    await expect(unexpectedType.loadUserAvatar('user-a')).rejects.toBeInstanceOf(NotFoundException);
  });
});
