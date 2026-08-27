import type { ConversationListResponse } from '../../../../packages/contracts/src/conversations';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { ConversationList } from './conversation-list';

export function InboxShell({
  conversations,
  selectedId,
  children,
}: {
  conversations: ConversationListResponse['items'];
  selectedId?: string;
  children: ReactNode;
}) {
  return (
    <main className="app-shell">
      <aside className="primary-nav">
        <Link className="brand" href="/conversations">AutoSale</Link>
        <nav aria-label="Головна навігація">
          <Link className="nav-item active" href="/conversations">
            <ChatIcon />
            <span>Діалоги</span>
          </Link>
          <Link className="nav-item" href="/orders"><span>Замовлення</span></Link>
          <Link className="nav-item" href="/settings"><span>Налаштування</span></Link>
        </nav>
        <div className="manager"><span className="manager-avatar">A</span><span>Андрій<small>Менеджер</small></span></div>
      </aside>
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

function ChatIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 5h14v11H9l-4 3V5Z" /></svg>;
}
function SearchIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 4 4" /></svg>;
}
function InstagramIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" /></svg>;
}
