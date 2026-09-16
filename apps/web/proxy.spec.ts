import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { proxy } from './proxy';

afterEach(() => vi.unstubAllGlobals());

describe('proxy', () => {
  it('sends an authenticated tenant user from sign-in to the dashboard', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ platformRole: 'USER', membershipRole: 'OWNER' }),
    }));

    const response = await proxy(new NextRequest('http://autosale.local/login'));

    expect(response.headers.get('location')).toBe('http://autosale.local/dashboard');
  });

  it.each(['/privacy', '/privacy/data-deletion', '/terms'])(
    'allows unauthenticated access to public legal page %s',
    async (pathname) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

      const response = await proxy(new NextRequest(`http://autosale.local${pathname}`));

      expect(response.headers.get('x-middleware-next')).toBe('1');
      expect(response.headers.get('location')).toBeNull();
    },
  );

  it('allows an authenticated tenant manager to reach settings', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ platformRole: 'USER', membershipRole: 'MANAGER' }),
    }));

    const response = await proxy(new NextRequest('http://autosale.local/settings'));

    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('location')).toBeNull();
  });
});
