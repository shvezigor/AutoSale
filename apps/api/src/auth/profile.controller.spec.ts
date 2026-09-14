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
    const controller = new ProfileController({ get } as never);

    await controller.get(principal);

    expect(get).toHaveBeenCalledWith(principal);
  });

  it('parses editable fields and delegates with the current principal', async () => {
    const update = vi.fn(async () => ({ userId: principal.userId }));
    const controller = new ProfileController({ update } as never);

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
    const controller = new ProfileController({ update } as never);

    expect(() => controller.update(principal, {
      name: 'Менеджер',
      phone: null,
      locale: 'uk',
      email: 'other@example.com',
    })).toThrow(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });
});
