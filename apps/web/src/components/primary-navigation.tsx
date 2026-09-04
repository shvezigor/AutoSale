'use client';

import type { PublicSession } from '../../../../packages/contracts/src/auth';
import Link from 'next/link';

type NavigationSession = Pick<PublicSession, 'name' | 'email' | 'membershipRole'>;
type Destination = 'conversations' | 'orders' | 'catalogue' | 'team' | 'settings';

export function PrimaryNavigation({ active, session }: { active: Destination; session: NavigationSession }) {
  const isOwner = session.membershipRole === 'OWNER';
  return <aside className="primary-nav">
    <Link className="brand" href="/conversations">AutoSale</Link>
    <nav aria-label="Головна навігація">
      <Link className={`nav-item${active === 'conversations' ? ' active' : ''}`} href="/conversations"><span>Діалоги</span></Link>
      <Link className={`nav-item${active === 'orders' ? ' active' : ''}`} href="/orders"><span>Замовлення</span></Link>
      {session.membershipRole && <Link className={`nav-item${active === 'catalogue' ? ' active' : ''}`} href="/catalogue"><span>Каталог</span></Link>}
      {isOwner && <Link className={`nav-item${active === 'team' ? ' active' : ''}`} href="/team"><span>Команда</span></Link>}
      {session.membershipRole && <Link className={`nav-item${active === 'settings' ? ' active' : ''}`} href="/settings"><span>Налаштування</span></Link>}
    </nav>
  </aside>;
}
