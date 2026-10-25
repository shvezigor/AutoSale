'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ConversationListResponse, ConversationStatusCounts, ConversationWorkflowStatus } from '../../../../packages/contracts/src/conversations';
import { changeConversationStatus, ConversationReplyApiError, refreshConversationList, refreshConversationStatusCounts } from '../api/conversation-replies';
import { useI18n } from '../i18n/i18n-provider';

type Status = ConversationWorkflowStatus;
type Page = ConversationListResponse & { firstIds: string[]; expanded: boolean };
type Triage = {
  status: Status; counts: ConversationStatusCounts; items: ConversationListResponse['items']; hasMore: boolean;
  loading: boolean; loadingMore: boolean; error: string; announcement: string;
  selectStatus(status: Status): void; loadMore(): Promise<void>; refresh(): Promise<void>;
  moveConversation(input: { id: string; status: Status; expectedVersion: number }): Promise<void>;
};
const Context = createContext<Triage | null>(null);
export const conversationStatuses: Status[] = ['ACTIVE', 'INACTIVE', 'CLOSED'];
export function useConversationTriage(): Triage {
  const value = useContext(Context);
  if (!value) throw new Error('ConversationTriageProvider is required');
  return value;
}
const pageState = (page: ConversationListResponse): Page => ({ ...page, firstIds: page.items.map(item => item.id), expanded: false });
const unique = (items: ConversationListResponse['items']) => [...new Map(items.map(item => [item.id, item])).values()];

export function ConversationTriageProvider({ initialPage, initialCounts, children }: { initialPage: ConversationListResponse; initialCounts: ConversationStatusCounts; children: ReactNode }) {
  const router = useRouter(); const pathname = usePathname(); const params = useSearchParams(); const { t } = useI18n();
  const queryStatus = params.get('status')?.toUpperCase();
  const status: Status = conversationStatuses.includes(queryStatus as Status) ? queryStatus as Status : 'ACTIVE';
  const [pages, setPages] = useState<Partial<Record<Status, Page>>>({ ACTIVE: pageState(initialPage) });
  const pagesRef = useRef(pages); pagesRef.current = pages;
  const previousStatus = useRef(status);
  const [counts, setCounts] = useState(initialCounts);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [mutationError, setMutationError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const error = mutationError || loadError;
  const inFlight = useRef(new Set<Status>());
  const generation = useRef(0);
  const countRequest = useRef(0);
  const rebuilding = useRef(false);
  const pendingRequests = useRef(new Set<Promise<unknown>>());
  const refreshPage = useCallback(async (target: Status) => {
    if (rebuilding.current || inFlight.current.has(target)) return;
    inFlight.current.add(target); const started = generation.current;
    try {
      const request = refreshConversationList({ status: target });
      pendingRequests.current.add(request);
      const response = await request.finally(() => pendingRequests.current.delete(request));
      if (started !== generation.current) return;
      setPages(previous => {
        const old = previous[target];
        if (!old?.expanded) return { ...previous, [target]: pageState(response) };
        // Replace the newest page while retaining older pages and keyed DOM rows.
        const boundary = response.items.at(-1);
        const tail = old.items.filter(item => !response.items.some(fresh => fresh.id === item.id) && (!old.firstIds.includes(item.id) || (response.nextCursor && boundary && (item.lastMessageAt < boundary.lastMessageAt || (item.lastMessageAt === boundary.lastMessageAt && item.id < boundary.id)))));
        return { ...previous, [target]: { ...old, items: [...response.items, ...tail], firstIds: response.items.map(item => item.id) } };
      });
      setLoadError('');
    } catch { setLoadError(t('conversations.triage.loadError')); }
    finally { inFlight.current.delete(target); }
  }, [t]);
  const refreshCounts = useCallback(async () => {
    const request = ++countRequest.current;
    const next = await refreshConversationStatusCounts();
    if (request === countRequest.current) setCounts(next);
  }, []);
  const refresh = useCallback(async () => {
    setMutationError('');
    // A mutation must not be overwritten by a first-page request already in flight.
    rebuilding.current = true;
    const refreshGeneration = ++generation.current;
    await Promise.allSettled([...pendingRequests.current]);
    try {
      const targets = conversationStatuses.filter(target => pagesRef.current[target] || target === status);
      const results = await Promise.allSettled([refreshCounts(), ...targets.map(async target => {
        const desiredSize = pagesRef.current[target]?.items.length ?? 0;
        const first = await refreshConversationList({ status: target });
        let items = first.items; let cursor = first.nextCursor;
        const seen = new Set<string>();
        while (cursor && items.length < desiredSize && !seen.has(cursor)) {
          seen.add(cursor);
          const next = await refreshConversationList({ status: target, cursor });
          items = unique([...items, ...next.items]); cursor = next.nextCursor;
        }
        if (refreshGeneration !== generation.current) return;
        setPages(previous => ({ ...previous, [target]: { items, nextCursor: cursor, firstIds: first.items.map(item => item.id), expanded: seen.size > 0 } }));
      })]);
      // A rejected sibling must not release the lock while category requests can still write.
      const failure = results.find(result => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
      setLoadError('');
    } catch (cause) { setLoadError(t('conversations.triage.loadError')); throw cause; }
    finally { if (refreshGeneration === generation.current) rebuilding.current = false; router.refresh(); }
  }, [refreshCounts, router, status, t]);
  useEffect(() => {
    if (!pagesRef.current[status] || previousStatus.current !== status) void refreshPage(status);
    previousStatus.current = status;
    const listTimer = window.setInterval(() => { if (document.visibilityState !== 'hidden') void refreshPage(status); }, 3000);
    const countTimer = window.setInterval(() => { if (document.visibilityState !== 'hidden') void refreshCounts().catch(() => {}); }, 15000);
    return () => { window.clearInterval(listTimer); window.clearInterval(countTimer); };
  }, [status, refreshPage, refreshCounts]);
  async function loadMore() {
    const page = pagesRef.current[status];
    if (!page?.nextCursor || rebuilding.current || inFlight.current.has(status)) return;
    inFlight.current.add(status); setLoadingMore(true); const started = generation.current;
    try {
      const request = refreshConversationList({ status, cursor: page.nextCursor });
      pendingRequests.current.add(request);
      const response = await request.finally(() => pendingRequests.current.delete(request));
      if (started === generation.current) setPages(previous => ({ ...previous, [status]: { ...page, items: unique([...page.items, ...response.items]), nextCursor: response.nextCursor, expanded: true } }));
      setLoadError('');
    } catch { setLoadError(t('conversations.triage.loadError')); }
    finally { inFlight.current.delete(status); setLoadingMore(false); }
  }
  async function moveConversation(input: { id: string; status: Status; expectedVersion: number }) {
    setLoadError(''); setMutationError(''); setAnnouncement('');
    try {
      const confirmed = await changeConversationStatus(input.id, { status: input.status, expectedVersion: input.expectedVersion });
      generation.current += 1;
      setPages(previous => Object.fromEntries(Object.entries(previous).map(([key, page]) => [key, { ...page, items: page.items.filter(item => item.id !== input.id || key === confirmed.status).map(item => item.id === input.id ? { ...item, workflowStatus: confirmed.status, statusVersion: confirmed.statusVersion } : item) }])));
      setAnnouncement(t('conversations.triage.moved'));
      await refresh().catch(() => {});
    } catch (cause) {
      if (cause instanceof ConversationReplyApiError && cause.status === 409) {
        try {
          await refresh();
          setMutationError(t('conversations.triage.conflict'));
        } catch { /* Keep the refresh failure visible; never claim stale data was refreshed. */ }
      } else setMutationError(t('conversations.triage.moveError'));
      throw cause;
    }
  }
  function selectStatus(next: Status) {
    const query = new URLSearchParams(params.toString()); query.set('status', next.toLowerCase());
    router.replace(`${pathname}?${query.toString()}`, { scroll: false });
  }
  return <Context.Provider value={{ status, counts, items: pages[status]?.items ?? [], hasMore: Boolean(pages[status]?.nextCursor), loading: !pages[status], loadingMore, error, announcement, selectStatus, loadMore, refresh, moveConversation }}>{children}</Context.Provider>;
}
