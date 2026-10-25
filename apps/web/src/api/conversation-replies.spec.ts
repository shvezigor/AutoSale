import { afterEach, describe, expect, it, vi } from 'vitest';
const csrf = vi.hoisted(() => ({ mutatingFetch: vi.fn() }));
vi.mock('../auth/csrf-fetch', () => csrf);
import { changeConversationStatus, refreshConversationList, refreshConversationStatusCounts } from './conversation-replies';
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe('conversation triage client API', () => {
  it('encodes status/cursor and preserves the unfiltered default', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [], nextCursor: null })));
    vi.stubGlobal('fetch', fetch);
    await refreshConversationList({ status: 'CLOSED', cursor: 'a/+=' });
    expect(fetch).toHaveBeenCalledWith('/api/conversations?limit=50&status=CLOSED&cursor=a%2F%2B%3D', { cache: 'no-store' });
    fetch.mockResolvedValue(new Response(JSON.stringify({ items: [], nextCursor: null })));
    await refreshConversationList();
    expect(fetch).toHaveBeenLastCalledWith('/api/conversations?limit=50', { cache: 'no-store' });
  });
  it('validates aggregate counts and uses the CSRF mutation helper', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ACTIVE: -1, INACTIVE: 0, CLOSED: 0 }))));
    await expect(refreshConversationStatusCounts()).rejects.toThrow();
    csrf.mutatingFetch.mockResolvedValue(new Response(JSON.stringify({ status: 'CLOSED', statusVersion: 1, statusChangedAt: null })));
    await changeConversationStatus('fixture', { status: 'CLOSED', expectedVersion: 0 });
    expect(csrf.mutatingFetch).toHaveBeenCalledWith('/api/conversations/fixture/status', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ status: 'CLOSED', expectedVersion: 0 }) }));
  });
});
