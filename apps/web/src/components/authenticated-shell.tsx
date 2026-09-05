'use client';

import type { PublicSession } from '../../../../packages/contracts/src/auth';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

import { ActivityProvider } from './activity-provider';
import { AppHeader } from './app-header';
import { PrimaryNavigation } from './primary-navigation';
import { ToastProvider } from './toast-provider';
import { ConfirmProvider } from './confirm-provider';

type Destination = 'conversations' | 'orders' | 'catalogue' | 'team' | 'settings';
type ShellSession = Pick<PublicSession, 'name' | 'email' | 'membershipRole'>;

export function AuthenticatedShell({ active, session, children }: { active: Destination; session: ShellSession; children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const closeMobile = useCallback(() => setMobileOpen(false), []);
  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const keyboard = (event: KeyboardEvent) => { if (event.key === 'Escape') { closeMobile(); menuTrigger.current?.focus(); } };
    document.addEventListener('keydown', keyboard);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', keyboard); };
  }, [closeMobile, mobileOpen]);
  return <ToastProvider><ActivityProvider><ConfirmProvider><div className="authenticated-shell">
    <PrimaryNavigation active={active} session={session} />
    <div className="authenticated-workspace"><AppHeader menuOpen={mobileOpen} menuTriggerRef={menuTrigger} onMenuToggle={() => setMobileOpen((value) => !value)} session={session} />{children}</div>
    {mobileOpen && <div className="mobile-nav-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeMobile(); }}><PrimaryNavigation active={active} ariaLabel="Мобільна навігація" className="mobile-nav-drawer" navId="mobile-navigation" onNavigate={closeMobile} session={session} /></div>}
  </div></ConfirmProvider></ActivityProvider></ToastProvider>;
}
