import { beforeEach, describe, expect, it, vi } from 'vitest';

const cookieGet = vi.fn();
const headerGet = vi.fn();

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: cookieGet })),
  headers: vi.fn(async () => ({ get: headerGet })),
}));

import { resolveServerLocale } from './server';

describe('server locale resolution', () => {
  beforeEach(() => {
    cookieGet.mockReset();
    headerGet.mockReset();
    cookieGet.mockReturnValue(undefined);
    headerGet.mockReturnValue(null);
  });

  it('prefers an authenticated user locale over every request hint', async () => {
    cookieGet.mockReturnValue({ value: 'uk' });
    headerGet.mockReturnValue('uk-UA');
    await expect(resolveServerLocale('en')).resolves.toBe('en');
    expect(cookieGet).not.toHaveBeenCalled();
  });

  it('uses the locale cookie before the browser language', async () => {
    cookieGet.mockReturnValue({ value: 'en' });
    headerGet.mockReturnValue('uk-UA');
    await expect(resolveServerLocale()).resolves.toBe('en');
  });

  it('uses a supported browser language and otherwise falls back to Ukrainian', async () => {
    headerGet.mockReturnValueOnce('en-US,en;q=0.8');
    await expect(resolveServerLocale()).resolves.toBe('en');
    headerGet.mockReturnValueOnce('pl-PL');
    await expect(resolveServerLocale()).resolves.toBe('uk');
  });
});
