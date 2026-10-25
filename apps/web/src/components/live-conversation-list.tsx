'use client';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { ConversationList } from './conversation-list';
import { useConversationTriage } from './conversation-triage-context';
import { LoadingButton } from './loading-button';
import { useI18n } from '../i18n/i18n-provider';
export function LiveConversationList() {
  const [retrying, setRetrying] = useState(false);
  const pathname = usePathname(); const { t } = useI18n();
  const { items, status, counts, loading, loadingMore, hasMore, loadMore, refresh, error, announcement } = useConversationTriage();
  const selectedId = pathname?.match(/^\/conversations\/([^/]+)/)?.[1];
  return <div className="inbox-status-panel" id="conversation-status-panel" role="tabpanel" tabIndex={0} aria-labelledby={`tab-${status}`}>
    {loading ? <p role="status">{t('conversations.triage.loading', { status: t(`conversations.triage.${status}`) })}</p> : items.length ? <ConversationList conversations={items} status={status} selectedId={selectedId ? decodeURIComponent(selectedId) : undefined} /> : <p className="empty-list">{t('conversations.triage.empty', { status: t(`conversations.triage.${status}`) })}</p>}
    <footer className="dialog-count">
      {hasMore && <LoadingButton className="secondary-button" pending={loadingMore} onClick={() => void loadMore()}>{t('conversations.triage.loadMore')}</LoadingButton>}
      <span>{t('conversations.total', { count: counts[status] })}</span>
      {error && <div role="alert">{error} <LoadingButton className="text-button" pending={retrying} onClick={() => { setRetrying(true); void refresh().catch(() => {}).finally(() => setRetrying(false)); }}>{t('conversations.triage.retry')}</LoadingButton></div>}
      <span role="status" className="sr-only">{announcement}</span>
    </footer>
  </div>;
}
