import type { AuthPrincipal } from '@autosale/contracts/auth';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { ProfileController } from './profile.controller.js';

const principal: AuthPrincipal = {
  userId: '10000000-0000-4000-8000-000000000001',
  sessionId: 'session-current',
  tenantId: '20000000-0000-4000-8000-000000000002',
  email: 'manager@example.com',
  name: 'Менеджер',
  locale: 'uk',
  avatarUrl: null,
  platformRole: 'USER',
  membershipRole: 'MANAGER',
};

describe('ProfileController', () => {
  it('lets a manager read their own profile without changing principal scope', async () => {
    const get = vi.fn(async () => ({ userId: principal.userId }));
    const controller = new ProfileController({ get } as never, {} as never);

    await controller.get(principal);

    expect(get).toHaveBeenCalledWith(principal);
  });

  it('parses editable fields and delegates with the current principal', async () => {
    const update = vi.fn(async () => ({ userId: principal.userId }));
    const controller = new ProfileController({ update } as never, {} as never);

    await controller.update(principal, {
      name: '  Нове ім’я  ',
      phone: ' +380 67 123 45 67 ',
      locale: 'en',
    });

    expect(update).toHaveBeenCalledWith(principal, {
      name: 'Нове ім’я',
      phone: '+380671234567',
      locale: 'en',
    });
  });

  it('rejects unknown profile fields before calling the service', async () => {
    const update = vi.fn();
    const controller = new ProfileController({ update } as never, {} as never);

    expect(() => controller.update(principal, {
      name: 'Менеджер',
      phone: null,
      locale: 'uk',
      email: 'other@example.com',
    })).toThrow(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('rate limits password changes by request IP and normalized authenticated email', async () => {
    const changePassword = vi.fn(async () => ({ changed: true, revokedSessions: 1 }));
    const consume = vi.fn(async () => undefined);
    const controller = new ProfileController({ changePassword } as never, { consume } as never);

    await controller.changePassword(
      { ...principal, email: ' Manager@Example.COM ' },
      {
        currentPassword: 'old password value',
        newPassword: 'new password value',
        confirmation: 'new password value',
      },
      { ip: '127.0.0.1', headers: {}, socket: {} } as never,
    );

    expect(consume).toHaveBeenCalledWith('profile-password', '127.0.0.1', 'manager@example.com', 5, 900);
    expect(changePassword).toHaveBeenCalledWith(expect.objectContaining({ userId: principal.userId }), {
      currentPassword: 'old password value',
      newPassword: 'new password value',
      confirmation: 'new password value',
    });
  });

  it('rejects an invalid password request before delegation', async () => {
    const changePassword = vi.fn();
    const consume = vi.fn();
    const controller = new ProfileController({ changePassword } as never, { consume } as never);

    await expect(controller.changePassword(
      principal,
      { currentPassword: 'old password value', newPassword: 'new password value', confirmation: 'different value' },
      { ip: '127.0.0.1', headers: {}, socket: {} } as never,
    )).rejects.toThrow(BadRequestException);
    expect(consume).not.toHaveBeenCalled();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('rate limits and delegates one avatar upload for the current user', async () => {
    const replaceAvatar = vi.fn(async () => ({ userId: principal.userId }));
    const consume = vi.fn(async () => undefined);
    const controller = new ProfileController({ replaceAvatar } as never, { consume } as never);
    const file = {
      buffer: Buffer.from([137, 80, 78, 71]),
      mimetype: 'image/png',
      originalname: 'avatar.png',
      size: 4,
    };

    await controller.replaceAvatar(principal, file, { ip: '127.0.0.1', headers: {}, socket: {} } as never);

    expect(consume).toHaveBeenCalledWith('profile-avatar', '127.0.0.1', principal.email, 20, 3600);
    expect(replaceAvatar).toHaveBeenCalledWith(principal, file);
  });

  it('rejects a missing avatar before storage delegation', async () => {
    const replaceAvatar = vi.fn();
    const consume = vi.fn();
    const controller = new ProfileController({ replaceAvatar } as never, { consume } as never);

    await expect(controller.replaceAvatar(
      principal,
      undefined,
      { ip: '127.0.0.1', headers: {}, socket: {} } as never,
    )).rejects.toThrow('PROFILE_AVATAR_REQUIRED');
    expect(consume).not.toHaveBeenCalled();
    expect(replaceAvatar).not.toHaveBeenCalled();
  });

  it('rate limits avatar removal and delegates to the current user scope', async () => {
    const removeAvatar = vi.fn(async () => ({ userId: principal.userId }));
    const consume = vi.fn(async () => undefined);
    const controller = new ProfileController({ removeAvatar } as never, { consume } as never);

    await controller.removeAvatar(principal, { ip: '127.0.0.1', headers: {}, socket: {} } as never);

    expect(consume).toHaveBeenCalledWith('profile-avatar', '127.0.0.1', principal.email, 20, 3600);
    expect(removeAvatar).toHaveBeenCalledWith(principal);
  });
});
