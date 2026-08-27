import { afterEach, describe, expect, it, vi } from 'vitest';

import { mutatingFetch } from './csrf-fetch';

afterEach(() => vi.unstubAllGlobals());

describe('mutatingFetch', () => {
  it('binds a CSRF token to authenticated mutations', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf-token' }) })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await mutatingFetch('/api/orders/id/approve', { method: 'POST' });

    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/orders/id/approve', expect.objectContaining({ headers: expect.objectContaining({ 'x-csrf-token': 'csrf-token' }) }));
  });
});
