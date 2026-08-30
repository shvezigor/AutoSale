import type { ConversationListResponse } from '../../../../packages/contracts/src/conversations';
import type { ReactNode } from 'react';
import type { PublicSession } from '../../../../packages/contracts/src/auth';

import { ConversationList } from './conversation-list';
import { PrimaryNavigation } from './primary-navigation';

export function InboxShell({
  conversations,
  selectedId,
  session,
  children,
}: {
  conversations: ConversationListResponse['items'];
  selectedId?: string;
  session: Pick<PublicSession, 'name' | 'email' | 'membershipRole'>;
  children: ReactNode;
}) {
  return (
    <main className="app-shell">
      <PrimaryNavigation active="conversations" session={session} />
      <section className="inbox-sidebar">
        <header className="inbox-heading">
          <h1>Діалоги</h1>
          <div className="channel-select"><InstagramIcon /> Instagram</div>
          <label className="search-field">
            <span className="sr-only">Пошук у діалогах</span>
            <SearchIcon />
            <input placeholder="Пошук у діалогах" type="search" />
          </label>
        </header>
        <ConversationList conversations={conversations} selectedId={selectedId} />
        <footer className="dialog-count">Усього діалогів: {conversations.length}</footer>
      </section>
      {children}
    </main>
  );
}

function SearchIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 4 4" /></svg>;
}
function InstagramIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" /></svg>;
}
