'use client';

import type { PublicSession } from '../../../../packages/contracts/src/auth';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

import { ActivityProvider } from './activity-provider';
import { AppHeader } from './app-header';
import { PrimaryNavigation } from './primary-navigation';
import { ToastProvider } from './toast-provider';
import { ConfirmProvider } from './confirm-provider';
import { useModalFocus } from './use-modal-focus';

type Destination = 'conversations' | 'orders' | 'catalogue' | 'team' | 'settings';
type ShellSession = Pick<PublicSession, 'name' | 'email' | 'membershipRole'>;

export function AuthenticatedShell({ active, session, children }: { active: Destination; session: ShellSession; children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLDivElement>(null);
  const closeMobile = useCallback(() => setMobileOpen(false), []);
  useModalFocus(mobileOpen, drawer, closeMobile);
  useEffect(() => { closeMobile(); }, [active, closeMobile]);
  return <ToastProvider><ActivityProvider><ConfirmProvider><div className="authenticated-shell">
    <PrimaryNavigation active={active} session={session} />
    <div className="authenticated-workspace" inert={mobileOpen}><AppHeader menuOpen={mobileOpen} menuTriggerRef={menuTrigger} onMenuToggle={() => { menuTrigger.current?.focus(); setMobileOpen(true); }} session={session} />{children}</div>
    {mobileOpen && <div ref={drawer} className="mobile-nav-backdrop" role="dialog" aria-modal="true" aria-label="Меню розділів" onMouseDown={(event) => { if (event.target === event.currentTarget) closeMobile(); }}><div className="mobile-nav-drawer"><button className="secondary-button" type="button" onClick={closeMobile}>Закрити меню</button><PrimaryNavigation active={active} ariaLabel="Мобільна навігація" navId="mobile-navigation" onNavigate={closeMobile} session={session} /></div></div>}
  </div></ConfirmProvider></ActivityProvider></ToastProvider>;
}
