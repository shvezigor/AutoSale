'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, type SVGProps, useCallback, useEffect, useRef, useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';
import { useI18n } from '../i18n/i18n-provider';
import { getAdminCopy } from './admin-copy';
import { ConfirmProvider } from './confirm-provider';
import { LoadingButton } from './loading-button';
import { LocaleSwitcher } from './locale-switcher';
import { ToastProvider } from './toast-provider';
import { useModalFocus } from './use-modal-focus';

type AdminShellSession = { name: string; email: string };

const items = [
  { href: '/admin', key: 'overview' as const, Icon: OverviewIcon },
  { href: '/admin/tenants', key: 'clients' as const, Icon: ClientsIcon },
  { href: '/admin/integrations', key: 'integrations' as const, Icon: IntegrationsIcon },
  { href: '/admin/operations', key: 'operations' as const, Icon: OperationsIcon },
];

export function isAdminNavigationItemActive(pathname: string, href: string) {
  return href === '/admin' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminShell({ session, children }: { session: AdminShellSession; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { locale } = useI18n();
  const text = getAdminCopy(locale);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLDivElement>(null);
  const closeMobile = useCallback(() => setMobileOpen(false), []);
  useModalFocus(mobileOpen, drawer, closeMobile);
  useEffect(() => closeMobile(), [pathname, closeMobile]);

  async function logout() {
    setLoggingOut(true);
    try {
      if ((await mutatingFetch('/api/auth/logout', { method: 'POST' })).ok) router.refresh();
    } finally {
      setLoggingOut(false);
    }
  }

  return <ToastProvider><ConfirmProvider><div className="admin-shell">
    <a className="skip-link" href="#admin-main">{locale === 'uk' ? 'Перейти до вмісту' : 'Skip to content'}</a>
    <AdminNavigation pathname={pathname} label={text.navigation} />
    <div className="admin-workspace" inert={mobileOpen}>
      <header className="admin-app-header">
        <div className="admin-header-leading">
          <button ref={menuTrigger} className="icon-button admin-mobile-menu" type="button" aria-label={text.shell.openMenu} onClick={() => setMobileOpen(true)}><MenuIcon /></button>
          <div><span>{text.shell.context}</span><strong>{session.name}</strong></div>
        </div>
        <div className="admin-header-actions"><LocaleSwitcher /><span className="admin-user-email">{session.email}</span><LoadingButton className="secondary-button" pending={loggingOut} pendingLabel={text.shell.loggingOut} type="button" onClick={() => void logout()}>{text.shell.logout}</LoadingButton></div>
      </header>
      <main id="admin-main" tabIndex={-1} className="admin-main">{children}</main>
    </div>
    {mobileOpen && <div ref={drawer} className="admin-mobile-backdrop" role="dialog" aria-modal="true" aria-label={text.navigation.label} onMouseDown={(event) => { if (event.target === event.currentTarget) closeMobile(); }}>
      <div className="admin-mobile-drawer"><button className="secondary-button" type="button" onClick={closeMobile}>{text.shell.closeMenu}</button><AdminNavigation pathname={pathname} label={text.navigation} onNavigate={closeMobile} /></div>
    </div>}
  </div></ConfirmProvider></ToastProvider>;
}

function AdminNavigation({ pathname, label, onNavigate }: { pathname: string; label: ReturnType<typeof getAdminCopy>['navigation']; onNavigate?: () => void }) {
  const navigationHandler = onNavigate ? { onClick: onNavigate } : {};
  return <aside className="admin-navigation">
    <Link className="admin-brand" href="/admin" {...navigationHandler}><span aria-hidden="true">A</span><strong>Sales AITO</strong></Link>
    <div className="admin-navigation-context">{label.label}</div>
    <nav aria-label={label.label}>{items.map(({ href, key, Icon }) => {
      const active = isAdminNavigationItemActive(pathname, href);
      return <Link key={href} className={`admin-nav-item${active ? ' active' : ''}`} href={href} aria-current={active ? 'page' : undefined} {...navigationHandler}><Icon /><span>{label[key]}</span></Link>;
    })}</nav>
  </aside>;
}

function MenuIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" /></svg>; }
function OverviewIcon(props: SVGProps<SVGSVGElement>) { return <svg aria-hidden="true" viewBox="0 0 24 24" {...props}><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></svg>; }
function ClientsIcon(props: SVGProps<SVGSVGElement>) { return <svg aria-hidden="true" viewBox="0 0 24 24" {...props}><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0M16 5.5a3 3 0 0 1 0 5M18 20a6 6 0 0 0-2.5-5" /></svg>; }
function IntegrationsIcon(props: SVGProps<SVGSVGElement>) { return <svg aria-hidden="true" viewBox="0 0 24 24" {...props}><path d="M8 12h8M6.5 8.5l-2-2a2.1 2.1 0 0 1 3-3l2 2M17.5 8.5l2-2a2.1 2.1 0 0 0-3-3l-2 2M6.5 15.5l-2 2a2.1 2.1 0 0 0 3 3l2-2M17.5 15.5l2 2a2.1 2.1 0 0 1-3 3l-2-2" /></svg>; }
function OperationsIcon(props: SVGProps<SVGSVGElement>) { return <svg aria-hidden="true" viewBox="0 0 24 24" {...props}><path d="M4 18V9M10 18V4M16 18v-6M22 18H2" /><circle cx="4" cy="7" r="1.5" /><circle cx="10" cy="2" r="1.5" /><circle cx="16" cy="10" r="1.5" /></svg>; }
