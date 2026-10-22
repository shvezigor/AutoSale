import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ toString: (): string => 'session=fictional-test-cookie' })),
}));

import { authenticatedApiFetch } from './session';

afterEach(() => vi.restoreAllMocks());

describe('authenticatedApiFetch diagnostics', () => {
  it('logs a slow internal request with a bounded route label and no query or credentials', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValueOnce(1_201);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await authenticatedApiFetch('/api/orders?search=fictional-private-search');

    const record = JSON.parse(String(warn.mock.calls[0]?.[0]));
    expect(record).toMatchObject({ event: 'web_upstream_slow', route: 'orders', statusClass: '2xx', durationMs: 1201 });
    expect(JSON.stringify(record)).not.toMatch(/fictional-private-search|fictional-test-cookie|\/api\/orders\?/);
  });

  it('correlates a failed internal request without changing the HTTP response', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('untrusted upstream body', { status: 503 }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const response = await authenticatedApiFetch('/api/orders/11111111-1111-4111-8111-111111111111');

    expect(response.status).toBe(503);
    const requestHeaders = new Headers(fetcher.mock.calls[0]?.[1]?.headers);
    const requestId = requestHeaders.get('x-request-id');
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    const record = JSON.parse(String(warn.mock.calls[0]?.[0]));
    expect(record).toMatchObject({ event: 'web_upstream_failed', route: 'orders', statusClass: '5xx', requestId });
    expect(JSON.stringify(record)).not.toMatch(/11111111-1111-4111-8111-111111111111|untrusted upstream body|fictional-test-cookie/);
  });

  it('preserves network errors while recording only safe diagnostics', async () => {
    const problem = new Error('fictional sensitive network detail');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(problem);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(authenticatedApiFetch('/api/orders')).rejects.toBe(problem);

    const record = JSON.parse(String(warn.mock.calls[0]?.[0]));
    expect(record).toMatchObject({ event: 'web_upstream_failed', route: 'orders', statusClass: 'network' });
    expect(JSON.stringify(record)).not.toContain('fictional sensitive network detail');
  });
});
