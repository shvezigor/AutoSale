import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ refreshConversation: vi.fn(), refreshConversationList: vi.fn(), refreshConversationStatusCounts: vi.fn(), changeConversationStatus: vi.fn() }));
const navigation = vi.hoisted(() => ({ query: '', replace: vi.fn(), refresh: vi.fn() }));
vi.mock('../api/conversation-replies', async importOriginal => ({ ...await importOriginal<object>(), ...api }));
vi.mock('next/navigation', () => ({ usePathname: () => '/conversations/test', useSearchParams: () => new URLSearchParams(navigation.query), useRouter: () => navigation }));
import { useConversationTriage } from './conversation-triage-context';
import { ConversationReplyApiError } from '../api/conversation-replies';
import { InboxShell } from './inbox-shell';
export const row = { id: '11111111-1111-4111-8111-111111111111', channel: 'INSTAGRAM' as const, workflowStatus: 'ACTIVE' as const, statusVersion: 0, participantName: 'Клієнт один', participantUsername: null, participantAvatarUrl: null, lastMessagePreview: 'Старе', lastMessageAt: '2026-10-25T10:00:00.000Z' };
const counts = { ACTIVE: 80, INACTIVE: 12, CLOSED: 7 };
beforeEach(() => { navigation.query = ''; vi.clearAllMocks(); api.refreshConversation.mockResolvedValue({ ...row, statusVersion: 2 }); api.refreshConversationList.mockResolvedValue({ items: [], nextCursor: null }); api.refreshConversationStatusCounts.mockResolvedValue(counts); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('InboxShell triage', () => {
  it.each([['active', 'Активні', 80], ['inactive', 'Неактивні', 12], ['closed', 'Закриті', 7]])('selects URL %s and shows full count', async (status, label, count) => {
    navigation.query = `status=${status}`;
    render(<InboxShell initialPage={{ items: [row], nextCursor: null }} initialCounts={counts}><div>Деталі</div></InboxShell>);
    expect(screen.getByRole('tab', { name: `${label} ${count}` })).toHaveAttribute('aria-selected', 'true');
    if (status !== 'active') expect(screen.queryByText('Старе')).not.toBeInTheDocument();
    await act(async () => {});
  });
  it('switches URL preserving detail and requests filtered data', async () => {
    const view = render(<InboxShell initialPage={{ items: [row], nextCursor: 'active-cursor' }} initialCounts={counts}>Деталі</InboxShell>);
    fireEvent.click(screen.getByRole('tab', { name: 'Закриті 7' }));
    expect(navigation.replace).toHaveBeenCalledWith('/conversations/test?status=closed', { scroll: false });
    navigation.query = 'status=closed';
    view.rerender(<InboxShell initialPage={{ items: [row], nextCursor: 'active-cursor' }} initialCounts={counts}>Деталі</InboxShell>);
    await act(async () => {});
    expect(api.refreshConversationList).toHaveBeenCalledWith({ status: 'CLOSED' });
  });
  it('appends deduplicated pages, preserves older rows and focus during polling', async () => {
    vi.useFakeTimers();
    api.refreshConversationList.mockResolvedValueOnce({ items: [row, { ...row, id: 'older', participantName: 'Клієнт два' }], nextCursor: null });
    render(<InboxShell initialPage={{ items: [row], nextCursor: 'next/+' }} initialCounts={counts}>Деталі</InboxShell>);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Завантажити ще' })));
    expect(api.refreshConversationList).toHaveBeenCalledWith({ status: 'ACTIVE', cursor: 'next/+' });
    expect(screen.getAllByRole('link')).toHaveLength(2);
    const older = screen.getByRole('link', { name: /Клієнт два/ }); older.focus();
    api.refreshConversationList.mockResolvedValue({ items: [{ ...row, lastMessagePreview: 'Нове' }], nextCursor: 'next/+' });
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(screen.getByText('Нове')).toBeVisible(); expect(older).toHaveFocus();
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.getByRole('tab', { name: 'Активні 80' })).toBeVisible();
    expect(screen.getByRole('link', { name: /Клієнт один/ })).toHaveAttribute('href', `/conversations/${row.id}?status=active`);
  });
});

function MoveProbe() {
  const { moveConversation } = useConversationTriage();
  return <button onClick={() => void moveConversation({ id: row.id, status: 'CLOSED', expectedVersion: 0 }).catch(() => {})}>Move fixture</button>;
}
describe('confirmed mutation recovery', () => {
  it('makes rows beyond the first 50 accessible without duplicating page overlap', async () => {
    const first = Array.from({ length: 50 }, (_, index) => ({ ...row, id: `fixture-${index}`, participantName: `Fixture ${index}` }));
    api.refreshConversationList.mockResolvedValue({ items: [first[49], { ...row, id: 'fixture-50' }], nextCursor: null });
    render(<InboxShell initialPage={{ items: first, nextCursor: 'page-2' }} initialCounts={counts}>Details</InboxShell>);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Завантажити ще' })));
    expect(screen.getAllByRole('link')).toHaveLength(51);
  });

  it('refreshes counts, list and selected detail after a confirmed move', async () => {
    api.changeConversationStatus.mockResolvedValue({ status: 'CLOSED', statusVersion: 1, statusChangedAt: null });
    render(<InboxShell initialPage={{ items: [row], nextCursor: null }} initialCounts={counts}><MoveProbe /></InboxShell>);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Move fixture' })));
    expect(api.changeConversationStatus).toHaveBeenCalledWith(row.id, { status: 'CLOSED', expectedVersion: 0 });
    expect(api.refreshConversationStatusCounts).toHaveBeenCalled();
    expect(navigation.refresh).toHaveBeenCalled();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
  it('recovers stale-version conflict and retains confirmed rows on other failures', async () => {
    api.changeConversationStatus.mockRejectedValue(new ConversationReplyApiError('safe', 409));
    api.refreshConversationList.mockResolvedValue({ items: [{ ...row, statusVersion: 2 }], nextCursor: null });
    render(<InboxShell initialPage={{ items: [row], nextCursor: null }} initialCounts={counts}><MoveProbe /></InboxShell>);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Move fixture' })));
    expect(navigation.refresh).toHaveBeenCalled(); expect(screen.getByRole('alert')).toBeVisible(); expect(screen.getByRole('link')).toBeVisible();
    api.changeConversationStatus.mockRejectedValue(new ConversationReplyApiError('safe', 503));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Move fixture' })));
    expect(screen.getByRole('link')).toBeVisible(); expect(screen.getByRole('alert')).toBeVisible();
  });
  it('defaults invalid status to Active and suspends polling while hidden', async () => {
    vi.useFakeTimers(); navigation.query = 'status=unknown';
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    render(<InboxShell initialPage={{ items: [row], nextCursor: null }} initialCounts={counts}>Details</InboxShell>);
    expect(screen.getByRole('tab', { selected: true })).toHaveAttribute('id', 'tab-ACTIVE');
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(api.refreshConversationList).not.toHaveBeenCalled(); expect(api.refreshConversationStatusCounts).not.toHaveBeenCalled();
    visibility.mockRestore();
  });
});
function RefreshProbe() {
  const { refresh, loadMore } = useConversationTriage();
  return <><button onClick={() => void refresh().catch(() => {})}>Refresh fixture</button><button onClick={() => void loadMore()}>Load fixture</button></>;
}

describe('review regressions', () => {
  it('keeps the rebuild lock until delayed category requests settle after counts fail', async () => {
    vi.useFakeTimers();
    let finishPage!: (value: { items: typeof row[]; nextCursor: string | null }) => void;
    const delayedPage = new Promise<{ items: typeof row[]; nextCursor: string | null }>(resolve => { finishPage = resolve; });
    api.refreshConversationList.mockReturnValueOnce(delayedPage);
    api.refreshConversationStatusCounts.mockRejectedValueOnce(new Error('counts unavailable'));
    render(<InboxShell initialPage={{ items: [row], nextCursor: 'older-cursor' }} initialCounts={counts}><RefreshProbe /></InboxShell>);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Refresh fixture' })));
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Load fixture' })));
    expect(api.refreshConversationList).toHaveBeenCalledTimes(1);
    expect(navigation.refresh).not.toHaveBeenCalled();
    await act(async () => finishPage({ items: [{ ...row, lastMessagePreview: 'Rebuilt' }], nextCursor: 'older-cursor' }));
    expect(navigation.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeVisible();
    api.refreshConversationList.mockResolvedValueOnce({ items: [{ ...row, id: 'older-row', lastMessagePreview: 'Older row' }], nextCursor: null });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Load fixture' })));
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.getByText('Older row')).toBeVisible();
  });

  it.each([503, 409])('keeps mutation feedback after a successful background poll (%s)', async status => {
    vi.useFakeTimers();
    api.changeConversationStatus.mockRejectedValue(new ConversationReplyApiError('safe', status));
    api.refreshConversationList.mockResolvedValue({ items: [row], nextCursor: null });
    render(<InboxShell initialPage={{ items: [row], nextCursor: null }} initialCounts={counts}><MoveProbe /><RefreshProbe /></InboxShell>);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Move fixture' })));
    const feedback = screen.getByRole('alert').textContent;
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(screen.getByRole('alert')).toHaveTextContent(feedback!);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Refresh fixture' })));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
