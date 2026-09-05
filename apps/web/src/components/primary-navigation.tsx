'use client';

import type { PublicSession } from '../../../../packages/contracts/src/auth';
import Link from 'next/link';

type NavigationSession = Pick<PublicSession, 'name' | 'email' | 'membershipRole'>;
type Destination = 'conversations' | 'orders' | 'catalogue' | 'team' | 'settings';

export function PrimaryNavigation({ active, session, ariaLabel = 'Головна навігація', className = '', navId, onNavigate }: { active: Destination; session: NavigationSession; ariaLabel?: string; className?: string; navId?: string; onNavigate?: () => void }) {
  const isOwner = session.membershipRole === 'OWNER';
  const navigationHandler = onNavigate ? { onClick: onNavigate } : {};
  return <aside className={`primary-nav ${className}`.trim()}>
    <Link className="brand" href="/conversations" {...navigationHandler}>AutoSale</Link>
    <nav aria-label={ariaLabel} id={navId}>
      <Link className={`nav-item${active === 'conversations' ? ' active' : ''}`} href="/conversations" {...navigationHandler}><span>Діалоги</span></Link>
      <Link className={`nav-item${active === 'orders' ? ' active' : ''}`} href="/orders" {...navigationHandler}><span>Замовлення</span></Link>
      {session.membershipRole && <Link className={`nav-item${active === 'catalogue' ? ' active' : ''}`} href="/catalogue" {...navigationHandler}><span>Каталог</span></Link>}
      {isOwner && <Link className={`nav-item${active === 'team' ? ' active' : ''}`} href="/team" {...navigationHandler}><span>Команда</span></Link>}
      {session.membershipRole && <Link className={`nav-item${active === 'settings' ? ' active' : ''}`} href="/settings" {...navigationHandler}><span>Налаштування</span></Link>}
    </nav>
  </aside>;
}
