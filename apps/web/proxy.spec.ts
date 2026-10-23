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

  it.each(['/', '/uk', '/en/pricing', '/images/sales-aito-ai-operator-hero.png'])(
    'allows unauthenticated access to public marketing resource %s',
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

  it.each(['/admin', '/admin/leads', '/admin/tenants/fictional-tenant'])(
    'redirects a tenant user before rendering protected route %s',
    async (pathname) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ platformRole: 'USER', membershipRole: 'OWNER' }),
      }));

      const response = await proxy(new NextRequest(`http://autosale.local${pathname}`, {
        headers: { RSC: '1', 'Next-Router-Prefetch': '1' },
      }));

      expect(response.headers.get('location')).toBe('http://autosale.local/dashboard');
      expect(response.headers.get('x-middleware-next')).toBeNull();
    },
  );

  it('fails closed when the session service is unavailable on an admin route', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('session service unavailable')));

    const response = await proxy(new NextRequest('http://autosale.local/admin/leads'));

    expect(response.headers.get('location')).toBe('http://autosale.local/login?next=%2Fadmin%2Fleads');
    expect(response.headers.get('x-middleware-next')).toBeNull();
  });

  it('keeps a platform admin out of the tenant workspace', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ platformRole: 'PLATFORM_ADMIN', membershipRole: null }),
    }));

    const response = await proxy(new NextRequest('http://autosale.local/dashboard'));

    expect(response.headers.get('location')).toBe('http://autosale.local/admin');
    expect(response.headers.get('x-middleware-next')).toBeNull();
  });
});
