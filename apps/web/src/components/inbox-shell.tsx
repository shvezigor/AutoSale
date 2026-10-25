'use client';

import type { ConversationListResponse, ConversationStatusCounts } from '../../../../packages/contracts/src/conversations';
import type { ReactNode } from 'react';

import { ConversationTriageProvider, conversationStatuses, useConversationTriage } from './conversation-triage-context';
import { LiveConversationList } from './live-conversation-list';
import { useI18n } from '../i18n/i18n-provider';

export function InboxShell({ initialPage, initialCounts, children }: { initialPage: ConversationListResponse; initialCounts: ConversationStatusCounts; children: ReactNode }) {
  return <ConversationTriageProvider initialPage={initialPage} initialCounts={initialCounts}><InboxContent>{children}</InboxContent></ConversationTriageProvider>;
}
function InboxContent({ children }: { children: ReactNode }) {
  const { status, counts, selectStatus } = useConversationTriage();
  const { t } = useI18n();
  return (
    <main className="app-shell app-shell-content">
      <section className="inbox-sidebar">
        <header className="inbox-heading">
          <div className="inbox-title-row">
            <h1>{t('conversations.title')}</h1>
            <span className="inbox-count" aria-label={t('conversations.total', { count: counts.ACTIVE + counts.INACTIVE + counts.CLOSED })}>{counts.ACTIVE + counts.INACTIVE + counts.CLOSED}</span>
          </div>
          <label className="search-field">
            <span className="sr-only">{t('conversations.search')}</span>
            <SearchIcon />
            <input placeholder={t('conversations.search')} type="search" />
          </label>
          <div className="inbox-status-tabs" role="tablist" aria-label={t('conversations.triage.label')}>
            {conversationStatuses.map((value, index) => <button key={value} type="button" className="text-button" role="tab" id={`tab-${value}`} aria-controls="conversation-status-panel" aria-selected={status === value} tabIndex={status === value ? 0 : -1} onClick={() => selectStatus(value)} onKeyDown={event => {
              const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : -1;
              if (next >= 0) { event.preventDefault(); const target = conversationStatuses[next]!; selectStatus(target); document.getElementById(`tab-${target}`)?.focus(); }
            }}>{t(`conversations.triage.${value}`)} <span>{counts[value]}</span></button>)}
          </div>
        </header>
        <LiveConversationList />
      </section>
      {children}
    </main>
  );
}

function SearchIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 4 4" /></svg>;
}
