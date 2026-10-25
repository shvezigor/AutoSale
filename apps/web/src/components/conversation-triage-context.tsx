'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ConversationListResponse, ConversationStatusCounts, ConversationWorkflowStatus } from '../../../../packages/contracts/src/conversations';
import { changeConversationStatus, ConversationReplyApiError, refreshConversation, refreshConversationList, refreshConversationStatusCounts } from '../api/conversation-replies';
import { useI18n } from '../i18n/i18n-provider';

type Status = ConversationWorkflowStatus;
type ConfirmedStatus = { workflowStatus: Status; statusVersion: number };
type Page = ConversationListResponse;
type Triage = {
  status: Status; counts: ConversationStatusCounts; items: ConversationListResponse['items']; hasMore: boolean;
  loading: boolean; loadingMore: boolean; error: string; announcement: string;
  pendingIds: Set<string>; recoveryIds: Set<string>;
  confirmStatus(id: string, status: ConfirmedStatus): void;
  confirmedStatus(id: string, initial: ConfirmedStatus): ConfirmedStatus;
  selectStatus(status: Status): void; loadMore(): Promise<void>; refresh(): Promise<void>;
  moveConversation(input: { id: string; status: Status; expectedVersion: number }): Promise<void>;
};
const Context = createContext<Triage | null>(null);
export const conversationStatuses: Status[] = ['ACTIVE', 'INACTIVE', 'CLOSED'];
export function useOptionalConversationTriage() { return useContext(Context); }
export function useConversationTriage(): Triage {
  const value = useContext(Context);
  if (!value) throw new Error('ConversationTriageProvider is required');
  return value;
}
const unique = (items: ConversationListResponse['items']) => [...new Map(items.map(item => [item.id, item])).values()];

async function fetchWindow(status: Status, desiredSize: number): Promise<Page> {
  const first = await refreshConversationList({ status });
  let items = first.items; let cursor = first.nextCursor;
  const seen = new Set<string>();
  while (cursor && items.length < desiredSize && !seen.has(cursor)) {
    seen.add(cursor);
    const next = await refreshConversationList({ status, cursor });
    items = unique([...items, ...next.items]); cursor = next.nextCursor;
  }
  return { items, nextCursor: cursor };
}

export function ConversationTriageProvider({ initialPage, initialCounts, children }: { initialPage: ConversationListResponse; initialCounts: ConversationStatusCounts; children: ReactNode }) {
  const router = useRouter(); const pathname = usePathname(); const params = useSearchParams(); const { t } = useI18n();
  const queryStatus = params.get('status')?.toUpperCase();
  const status: Status = conversationStatuses.includes(queryStatus as Status) ? queryStatus as Status : 'ACTIVE';
  const [pages, setPages] = useState<Partial<Record<Status, Page>>>({ ACTIVE: initialPage });
  const pagesRef = useRef(pages); pagesRef.current = pages;
  const previousStatus = useRef(status);
  const [confirmed, setConfirmed] = useState<Record<string, ConfirmedStatus>>({});
  const confirmStatus = useCallback((id: string, status: ConfirmedStatus) => {
    setConfirmed(previous => previous[id] && previous[id].statusVersion >= status.statusVersion
      ? previous : { ...previous, [id]: status });
  }, []);
  const pendingRef = useRef(new Set<string>());
  const [pendingIds, setPendingIds] = useState(new Set<string>());
  const recoveryRef = useRef(new Set<string>());
  const [recoveryIds, setRecoveryIds] = useState(new Set<string>());
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
      // Revalidate the entire loaded window: cached tail membership can change externally.
      const desiredSize = pagesRef.current[target]?.items.length ?? 0;
      const request = fetchWindow(target, desiredSize);
      pendingRequests.current.add(request);
      const page = await request.finally(() => pendingRequests.current.delete(request));
      if (started !== generation.current) return;
      setPages(previous => ({ ...previous, [target]: page }));
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
    if (!recoveryRef.current.size) setMutationError('');
    const recoveringIds = [...recoveryRef.current];
    // A mutation must not be overwritten by a first-page request already in flight.
    rebuilding.current = true;
    const refreshGeneration = ++generation.current;
    await Promise.allSettled([...pendingRequests.current]);
    try {
      const targets = conversationStatuses.filter(target => pagesRef.current[target] || target === status);
      const results = await Promise.allSettled([refreshCounts(), ...recoveringIds.map(async id => {
        const detail = await refreshConversation(id);
        if (refreshGeneration !== generation.current) return;
        confirmStatus(id, detail);
      }), ...targets.map(async target => {
        const page = await fetchWindow(target, pagesRef.current[target]?.items.length ?? 0);
        if (refreshGeneration !== generation.current) return;
        setPages(previous => ({ ...previous, [target]: page }));
      })]);
      // A rejected sibling must not release the lock while category requests can still write.
      const failure = results.find(result => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
      if (refreshGeneration !== generation.current) return;
      recoveringIds.forEach(id => recoveryRef.current.delete(id));
      setRecoveryIds(new Set(recoveryRef.current));
      setMutationError(recoveryRef.current.size ? t('conversations.triage.loadError') : '');
      setLoadError('');
      router.refresh();
    } catch (cause) { setLoadError(t('conversations.triage.loadError')); throw cause; }
    finally { if (refreshGeneration === generation.current) rebuilding.current = false; }
  }, [confirmStatus, refreshCounts, router, status, t]);
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
      if (started === generation.current) setPages(previous => ({ ...previous, [status]: { ...page, items: unique([...page.items, ...response.items]), nextCursor: response.nextCursor } }));
      setLoadError('');
    } catch { setLoadError(t('conversations.triage.loadError')); }
    finally { inFlight.current.delete(status); setLoadingMore(false); }
  }
  async function moveConversation(input: { id: string; status: Status; expectedVersion: number }) {
    if (pendingRef.current.has(input.id) || recoveryRef.current.has(input.id)) return;
    pendingRef.current.add(input.id); setPendingIds(new Set(pendingRef.current));
    setLoadError(''); setMutationError(''); setAnnouncement('');
    try {
      const confirmed = await changeConversationStatus(input.id, { status: input.status, expectedVersion: input.expectedVersion });
      confirmStatus(input.id, { workflowStatus: confirmed.status, statusVersion: confirmed.statusVersion });
      generation.current += 1;
      setPages(previous => Object.fromEntries(Object.entries(previous).map(([key, page]) => [key, { ...page, items: page.items.filter(item => item.id !== input.id || key === confirmed.status).map(item => item.id === input.id ? { ...item, workflowStatus: confirmed.status, statusVersion: confirmed.statusVersion } : item) }])));
      setAnnouncement(t('conversations.triage.moved'));
      await refresh().catch(() => {});
    } catch (cause) {
      if (cause instanceof ConversationReplyApiError && cause.status === 409) {
        recoveryRef.current.add(input.id); setRecoveryIds(new Set(recoveryRef.current));
        try {
          await refresh();
          setMutationError(t(recoveryRef.current.has(input.id) ? 'conversations.triage.loadError' : 'conversations.triage.conflict'));
        } catch { setMutationError(t('conversations.triage.loadError')); }
      } else setMutationError(t('conversations.triage.moveError'));
      throw cause;
    } finally { pendingRef.current.delete(input.id); setPendingIds(new Set(pendingRef.current)); }
  }
  function confirmedStatus(id: string, initial: ConfirmedStatus): ConfirmedStatus {
    // Server detail props and cached pages can advance independently. Never regress a version.
    const candidates = [initial, confirmed[id], ...Object.values(pages).flatMap(page => page.items.filter(item => item.id === id))];
    return candidates.reduce<ConfirmedStatus>((latest, item) => item && item.statusVersion > latest.statusVersion ? item : latest, initial);
  }
  function selectStatus(next: Status) {
    const query = new URLSearchParams(params.toString()); query.set('status', next.toLowerCase());
    router.replace(`${pathname}?${query.toString()}`, { scroll: false });
  }
  return <Context.Provider value={{ pendingIds, recoveryIds, confirmStatus, confirmedStatus, status, counts, items: pages[status]?.items ?? [], hasMore: Boolean(pages[status]?.nextCursor), loading: !pages[status], loadingMore, error, announcement, selectStatus, loadMore, refresh, moveConversation }}>{children}</Context.Provider>;
}
