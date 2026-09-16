'use client';

import type { ConversationListResponse } from '../../../../packages/contracts/src/conversations';
import type { ReactNode } from 'react';

import { LiveConversationList } from './live-conversation-list';
import { useI18n } from '../i18n/i18n-provider';

export function InboxShell({
  conversations,
  children,
}: {
  conversations: ConversationListResponse['items'];
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <main className="app-shell app-shell-content">
      <section className="inbox-sidebar">
        <header className="inbox-heading">
          <div className="inbox-title-row">
            <h1>{t('conversations.title')}</h1>
            <span className="inbox-count" aria-label={t('conversations.total', { count: conversations.length })}>{conversations.length}</span>
          </div>
          <label className="search-field">
            <span className="sr-only">{t('conversations.search')}</span>
            <SearchIcon />
            <input placeholder={t('conversations.search')} type="search" />
          </label>
        </header>
        <LiveConversationList conversations={conversations} />
      </section>
      {children}
    </main>
  );
}

function SearchIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 4 4" /></svg>;
}
