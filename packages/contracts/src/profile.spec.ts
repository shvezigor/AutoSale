import { describe, expect, it } from 'vitest';

import { changePasswordRequestSchema, profileResponseSchema, updateProfileRequestSchema } from './profile.js';

const base = {
  userId: '10000000-0000-4000-8000-000000000001',
  email: 'owner@example.com',
  name: 'Ігор Швець',
  phone: '+380671234567',
  locale: 'uk',
  avatarUrl: null,
  membershipRole: 'OWNER',
  signInMethods: ['PASSWORD'],
  canChangePassword: true,
  createdAt: '2026-09-01T10:00:00.000Z',
  lastLoginAt: '2026-09-14T12:00:00.000Z',
} as const;

describe('profile contracts', () => {
  it('accepts a safe public profile and rejects password internals', () => {
    expect(profileResponseSchema.parse(base)).toEqual(base);
    expect(profileResponseSchema.safeParse({ ...base, passwordHash: 'secret' }).success).toBe(false);
  });

  it('normalizes profile edits and rejects unknown fields', () => {
    expect(updateProfileRequestSchema.parse({
      name: '  Ігор Швець  ',
      phone: ' +380 67 123 45 67 ',
      locale: 'uk',
    })).toEqual({ name: 'Ігор Швець', phone: '+380671234567', locale: 'uk' });
    expect(updateProfileRequestSchema.safeParse({ name: 'Ігор', email: 'other@example.com' }).success).toBe(false);
  });

  it('requires a strong confirmed replacement password', () => {
    expect(changePasswordRequestSchema.safeParse({
      currentPassword: 'old password value',
      newPassword: 'new password value',
      confirmation: 'different value',
    }).success).toBe(false);
    expect(changePasswordRequestSchema.parse({
      currentPassword: 'old password value',
      newPassword: 'new password value',
      confirmation: 'new password value',
    }).newPassword).toBe('new password value');
  });
});
