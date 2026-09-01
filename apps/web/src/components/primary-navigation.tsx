'use client';

import type { PublicSession } from '../../../../packages/contracts/src/auth';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutatingFetch } from '../auth/csrf-fetch';

type NavigationSession = Pick<PublicSession, 'name' | 'email' | 'membershipRole'>;
type Destination = 'conversations' | 'orders' | 'catalogue' | 'team' | 'settings';

export function PrimaryNavigation({ active, session }: { active: Destination; session: NavigationSession }) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const isOwner = session.membershipRole === 'OWNER';
  async function logout() {
    setLoggingOut(true);
    try { if ((await mutatingFetch('/api/auth/logout', { method: 'POST' })).ok) router.refresh(); }
    finally { setLoggingOut(false); }
  }
  return <aside className="primary-nav">
    <Link className="brand" href="/conversations">AutoSale</Link>
    <nav aria-label="Головна навігація">
      <Link className={`nav-item${active === 'conversations' ? ' active' : ''}`} href="/conversations"><span>Діалоги</span></Link>
      <Link className={`nav-item${active === 'orders' ? ' active' : ''}`} href="/orders"><span>Замовлення</span></Link>
      {session.membershipRole && <Link className={`nav-item${active === 'catalogue' ? ' active' : ''}`} href="/catalogue"><span>Каталог</span></Link>}
      {isOwner && <Link className={`nav-item${active === 'team' ? ' active' : ''}`} href="/team"><span>Команда</span></Link>}
      {session.membershipRole && <Link className={`nav-item${active === 'settings' ? ' active' : ''}`} href="/settings"><span>Налаштування</span></Link>}
    </nav>
    <div className="manager"><span className="manager-avatar">{session.name.slice(0, 1).toUpperCase()}</span><span>{session.name}<small>{isOwner ? 'Власник' : 'Менеджер'}</small></span></div>
    <button className="logout-button" disabled={loggingOut} onClick={logout} type="button">{loggingOut ? 'Вихід…' : 'Вийти'}</button>
  </aside>;
}
