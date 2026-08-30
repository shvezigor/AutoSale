import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { proxy } from './proxy';

afterEach(() => vi.unstubAllGlobals());

describe('proxy', () => {
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
