'use client';

import type { WorkspaceSearchResponse } from '../../../../packages/contracts/src/search';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { searchWorkspace } from '../api/workspace-search';
import { useI18n } from '../i18n/i18n-provider';

type SearchStatus = 'idle' | 'loading' | 'ready' | 'error';
type SearchItem = { key: string; href: string; kind: 'customer' | 'order' | 'product'; primary: string; secondary: string | null; meta: string | null };
const orderStatusKeys = {
  AI_PROCESSING: 'orders.aiProcessing',
  AI_FAILED: 'orders.aiFailed',
  NEEDS_REVIEW: 'orders.needsReview',
  AUTO_APPROVED: 'orders.autoApproved',
  APPROVED: 'orders.approved',
  CANCELLED: 'orders.cancelled',
} as const;

export function WorkspaceSearch() {
  const { t, formatNumber } = useI18n();
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [result, setResult] = useState<WorkspaceSearchResponse | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [retryVersion, setRetryVersion] = useState(0);
  const items = useMemo(() => flattenResults(result, t, formatNumber), [formatNumber, result, t]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setResult(null);
    setStatus('idle');
    setActiveIndex(-1);
    triggerRef.current?.focus();
  }, []);

  const show = useCallback(() => setOpen(true), []);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        show();
      } else if (event.key === 'Escape' && open) {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, [close, open, show]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const normalized = query.trim();
    if (normalized.length < 2) {
      setStatus('idle');
      setResult(null);
      setActiveIndex(-1);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setStatus('loading');
      try {
        const next = await searchWorkspace(normalized, controller.signal);
        if (controller.signal.aborted) return;
        setResult(next);
        setStatus('ready');
        setActiveIndex(-1);
      } catch {
        if (controller.signal.aborted) return;
        setResult(null);
        setStatus('error');
        setActiveIndex(-1);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, retryVersion]);

  function select(item: SearchItem) {
    setOpen(false);
    setQuery('');
    router.push(item.href);
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!items.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => current >= items.length - 1 ? 0 : current + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => current <= 0 ? items.length - 1 : current - 1);
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      select(items[activeIndex]!);
    }
  }

  return <div className="workspace-search-root">
    <button ref={triggerRef} className="app-header-search" type="button" aria-label={t('search.label')} aria-haspopup="dialog" aria-expanded={open} onClick={show}>
      <SearchIcon /><span>{t('header.searchPlaceholder')}</span><kbd>⌘ K</kbd>
    </button>
    {open && <div className="workspace-search-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="workspace-search-dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-search-title">
        <header className="workspace-search-heading">
          <div><strong id="workspace-search-title">{t('search.label')}</strong><span>{t('search.description')}</span></div>
          <button className="icon-button" type="button" aria-label={t('search.close')} onClick={close}>×</button>
        </header>
        <div className="workspace-search-input-wrap">
          <SearchIcon />
          <input ref={inputRef} type="search" role="combobox" aria-label={t('search.label')} aria-autocomplete="list" aria-controls="workspace-search-results" aria-expanded={status === 'ready' && items.length > 0} aria-activedescendant={activeIndex >= 0 ? `workspace-search-option-${activeIndex}` : undefined} placeholder={t('header.searchPlaceholder')} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onInputKeyDown} />
          {status === 'loading' && <span className="workspace-search-spinner" aria-label={t('search.loading')} />}
        </div>
        <div id="workspace-search-results" className="workspace-search-results" role="listbox" aria-label={t('search.results')}>
          {status === 'idle' && <p className="workspace-search-state">{t('search.minimum')}</p>}
          {status === 'loading' && <p className="workspace-search-state" aria-live="polite">{t('search.loading')}</p>}
          {status === 'error' && <div className="workspace-search-state" role="alert"><p>{t('search.error')}</p><button className="text-button" type="button" onClick={() => setRetryVersion((value) => value + 1)}>{t('search.retry')}</button></div>}
          {status === 'ready' && items.length === 0 && <p className="workspace-search-state">{t('search.empty')}</p>}
          {status === 'ready' && items.length > 0 && <ResultGroups result={result!} items={items} activeIndex={activeIndex} onActive={setActiveIndex} onSelect={select} />}
        </div>
      </section>
    </div>}
  </div>;
}

function ResultGroups({ result, items, activeIndex, onActive, onSelect }: { result: WorkspaceSearchResponse; items: SearchItem[]; activeIndex: number; onActive(index: number): void; onSelect(item: SearchItem): void }) {
  const { t } = useI18n();
  const groups = [
    { kind: 'customer' as const, heading: t('search.customers'), count: result.customers.length },
    { kind: 'order' as const, heading: t('search.orders'), count: result.orders.length },
    { kind: 'product' as const, heading: t('search.products'), count: result.products.length },
  ];
  return <>{groups.filter((group) => group.count > 0).map((group) => <section className="workspace-search-group" key={group.kind} aria-labelledby={`workspace-search-${group.kind}`}>
    <h2 id={`workspace-search-${group.kind}`}>{group.heading}</h2>
    {items.map((item, index) => item.kind === group.kind && <a id={`workspace-search-option-${index}`} className="workspace-search-option" data-active={activeIndex === index} role="option" aria-selected={activeIndex === index} href={item.href} key={item.key} onMouseEnter={() => onActive(index)} onClick={(event) => { event.preventDefault(); onSelect(item); }}>
      <span className={`workspace-search-type type-${item.kind}`} aria-hidden="true">{group.heading.slice(0, 1)}</span>
      <span className="workspace-search-option-copy"><strong>{item.primary}</strong>{item.secondary && <small>{item.secondary}</small>}</span>
      {item.meta && <span className="workspace-search-option-meta">{item.meta}</span>}
    </a>)}
  </section>)}</>;
}

function flattenResults(result: WorkspaceSearchResponse | null, t: ReturnType<typeof useI18n>['t'], formatNumber: ReturnType<typeof useI18n>['formatNumber']): SearchItem[] {
  if (!result) return [];
  return [
    ...result.customers.map((customer) => ({ key: `customer:${customer.key}`, href: customer.href, kind: 'customer' as const, primary: customer.name, secondary: customer.context, meta: t('search.customer') })),
    ...result.orders.map((order) => ({ key: `order:${order.id}`, href: order.href, kind: 'order' as const, primary: order.publicNumber, secondary: [order.customerName, order.productSummary].filter(Boolean).join(' · ') || null, meta: t(orderStatusKeys[order.status]) })),
    ...result.products.map((product) => ({ key: `product:${product.id}`, href: product.href, kind: 'product' as const, primary: product.name, secondary: product.sku, meta: product.price === null ? t('search.priceMissing') : `${formatNumber(product.price)} ${product.currency ?? ''}`.trim() })),
  ];
}

function SearchIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 4 4" /></svg>; }
