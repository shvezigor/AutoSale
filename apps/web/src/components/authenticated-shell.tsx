'use client';

import type { PublicSession } from '../../../../packages/contracts/src/auth';
import { usePathname } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { ActivityProvider } from './activity-provider';
import { AppHeader } from './app-header';
import { PrimaryNavigation } from './primary-navigation';
import { ToastProvider } from './toast-provider';
import { ConfirmProvider } from './confirm-provider';
import { SIDEBAR_STORAGE_KEY } from './sidebar-preference';
import { useModalFocus } from './use-modal-focus';

type ShellSession = Pick<PublicSession, 'name' | 'email' | 'membershipRole'>;

export function AuthenticatedShell({ session, children }: { session: ShellSession; children: ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLDivElement>(null);
  const closeMobile = useCallback(() => setMobileOpen(false), []);
  useModalFocus(mobileOpen, drawer, closeMobile);
  useLayoutEffect(() => {
    setCollapsed(document.documentElement.dataset.sidebarState === 'collapsed');
  }, []);
  useEffect(() => { closeMobile(); }, [pathname, closeMobile]);

  function toggleSidebar() {
    const nextCollapsed = !collapsed;
    const value = nextCollapsed ? 'collapsed' : 'expanded';
    setCollapsed(nextCollapsed);
    document.documentElement.dataset.sidebarState = value;
    try { localStorage.setItem(SIDEBAR_STORAGE_KEY, value); } catch { /* Browser privacy settings may disable storage. */ }
  }

  return <ToastProvider><ActivityProvider><ConfirmProvider><div className="authenticated-shell">
    <PrimaryNavigation collapsed={collapsed} onToggleCollapse={toggleSidebar} session={session} />
    <div className="authenticated-workspace" inert={mobileOpen}><AppHeader menuOpen={mobileOpen} menuTriggerRef={menuTrigger} onMenuToggle={() => { menuTrigger.current?.focus(); setMobileOpen(true); }} session={session} />{children}</div>
    {mobileOpen && <div ref={drawer} className="mobile-nav-backdrop" role="dialog" aria-modal="true" aria-label="Меню розділів" onMouseDown={(event) => { if (event.target === event.currentTarget) closeMobile(); }}><div className="mobile-nav-drawer"><button className="secondary-button" type="button" onClick={closeMobile}>Закрити меню</button><PrimaryNavigation ariaLabel="Мобільна навігація" navId="mobile-navigation" onNavigate={closeMobile} session={session} /></div></div>}
  </div></ConfirmProvider></ActivityProvider></ToastProvider>;
}
