import type { PrismaClient } from '@autosale/database';
import { describe, expect, it, vi } from 'vitest';
import { bootstrapIdentity, parseBootstrapInput } from './bootstrap-auth.js';

describe('auth bootstrap', () => {
  it('reads credentials from stdin JSON and rejects password arguments', () => {
    expect(parseBootstrapInput('{"email":" Admin@Example.com ","name":"Admin","password":"long-secure-password"}', [])).toMatchObject({ email: 'admin@example.com' });
    expect(() => parseBootstrapInput('{}', ['--password=secret'])).toThrow(/stdin/i);
  });

  it('creates an admin idempotently by normalized email', async () => {
    const upsert = vi.fn(async () => ({ id: 'user-1' }));
    const prisma = { user: { upsert } } as unknown as PrismaClient;
    const crypto = { hashPassword: vi.fn(async () => 'argon-hash') } as never;
    await bootstrapIdentity(prisma, crypto, 'admin', { email: 'admin@example.com', name: 'Admin', password: 'long-secure-password' });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { email: 'admin@example.com' }, update: expect.objectContaining({ platformRole: 'PLATFORM_ADMIN' }) }));
  });
});
