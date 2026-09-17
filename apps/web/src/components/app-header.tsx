'use client';

import type { PublicSession } from '../../../../packages/contracts/src/auth';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';

import { getNotifications, markAllNotificationsRead, markNotificationRead, type NotificationItem } from '../api/notifications';
import { mutatingFetch } from '../auth/csrf-fetch';
import { useI18n } from '../i18n/i18n-provider';
import { LocaleSwitcher } from './locale-switcher';

type HeaderSession = Pick<PublicSession, 'name' | 'email' | 'membershipRole' | 'avatarUrl'>;

export function AppHeader({ session, menuOpen = false, menuTriggerRef, onMenuToggle }: { session: HeaderSession; menuOpen?: boolean; menuTriggerRef?: RefObject<HTMLButtonElement | null>; onMenuToggle?: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<'notifications' | 'profile' | null>(null);
  return <header className="app-header">
    <div className="app-header-leading">{onMenuToggle && <button ref={menuTriggerRef} className="mobile-menu-trigger" type="button" aria-label={menuOpen ? t('header.closeMenu') : t('header.openMenu')} aria-expanded={menuOpen} aria-controls="mobile-navigation" onClick={onMenuToggle}><span /><span /><span /></button>}<span className="app-header-context sr-only">{t('header.workspace')}</span><div className="app-header-search" aria-label={t('header.searchUnavailable')} aria-disabled="true"><SearchIcon /><span>{t('header.searchPlaceholder')}</span><kbd>⌘ K</kbd></div></div>
    <div className="app-header-actions">
      <LocaleSwitcher />
      <NotificationCenter open={open === 'notifications'} onToggle={() => setOpen((value) => value === 'notifications' ? null : 'notifications')} onClose={() => setOpen(null)} />
      <ProfileMenu session={session} open={open === 'profile'} onToggle={() => setOpen((value) => value === 'profile' ? null : 'profile')} onClose={() => setOpen(null)} />
    </div>
  </header>;
}

function NotificationCenter({ open, onToggle, onClose }: { open: boolean; onToggle(): void; onClose(): void }) {
  const { t } = useI18n();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const load = useCallback(async () => {
    setStatus('loading');
    try { const result = await getNotifications(); setItems(result.items); setUnreadCount(result.unreadCount); setStatus('ready'); }
    catch { setStatus('error'); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => { document.removeEventListener('visibilitychange', refresh); window.clearInterval(timer); };
  }, [load]);
  usePopoverDismiss(open, root, trigger, onClose);

  async function readAll() {
    await markAllNotificationsRead();
    setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })));
    setUnreadCount(0);
  }
  async function readOne(item: NotificationItem) {
    if (item.readAt) return;
    await markNotificationRead(item.id);
    setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, readAt: new Date().toISOString() } : entry));
    setUnreadCount((value) => Math.max(0, value - 1));
  }

  return <div className="header-popover-root" ref={root}>
    <button ref={trigger} className="header-icon-button" type="button" aria-label={unreadCount ? t('header.unreadLabel', { count: unreadCount }) : t('header.notifications')} aria-expanded={open} aria-controls="notification-popover" onClick={onToggle}>
      <BellIcon />{unreadCount > 0 && <span className="notification-badge" aria-hidden="true">{unreadCount > 99 ? '99+' : unreadCount}</span>}
    </button>
    {open && <section id="notification-popover" className="header-popover notification-popover" aria-label={t('header.center')}>
      <header><div><strong>{t('header.notifications')}</strong><span>{unreadCount ? t('header.unreadCount', { count: unreadCount }) : t('header.allViewed')}</span></div>{unreadCount > 0 && <button type="button" onClick={() => void readAll()}>{t('header.readAll')}</button>}</header>
      {status === 'loading' && <div className="popover-state" aria-busy="true">{t('header.loading')}</div>}
      {status === 'error' && <div className="popover-state" role="alert">{t('header.loadError')}<button type="button" onClick={() => void load()}>{t('header.retry')}</button></div>}
      {status === 'ready' && items.length === 0 && <div className="popover-state">{t('header.empty')}</div>}
      {status === 'ready' && items.length > 0 && <ul className="notification-list">{items.map((item) => <li key={item.id} data-unread={!item.readAt}>
        {item.actionUrl ? <Link href={item.actionUrl} onClick={() => { void readOne(item); onClose(); }}><NotificationCopy item={item} /></Link> : <button type="button" onClick={() => void readOne(item)}><NotificationCopy item={item} /></button>}
      </li>)}</ul>}
    </section>}
  </div>;
}

function NotificationCopy({ item }: { item: NotificationItem }) {
  const { t } = useI18n();
  return <><span className={`notification-dot type-${item.type.toLowerCase()}`} aria-hidden="true" /><span><strong>{item.title}</strong>{item.message && <small>{item.message}</small>}<time dateTime={item.createdAt}>{relativeTime(item.createdAt, t)}</time></span></>;
}

function ProfileMenu({ session, open, onToggle, onClose }: { session: HeaderSession; open: boolean; onToggle(): void; onClose(): void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  usePopoverDismiss(open, root, trigger, onClose);
  async function logout() {
    setLoggingOut(true);
    try { if ((await mutatingFetch('/api/auth/logout', { method: 'POST' })).ok) router.refresh(); }
    finally { setLoggingOut(false); }
  }
  return <div className="header-popover-root" ref={root}>
    <button ref={trigger} className="profile-trigger" type="button" aria-label={t('header.profileMenu')} aria-expanded={open} aria-controls="profile-popover" onClick={onToggle}>
      {session.avatarUrl
        ? <img className="manager-avatar" src={session.avatarUrl} alt={t('header.profilePhoto', { name: session.name })} />
        : <span className="manager-avatar" aria-label={t('header.initial', { initial: session.name.slice(0, 1).toUpperCase() })}>{session.name.slice(0, 1).toUpperCase()}</span>}
      <span className="profile-trigger-copy"><strong>{session.name}</strong><small>{session.email}</small></span>
    </button>
    {open && <div id="profile-popover" className="header-popover profile-popover" role="menu">
      <div className="profile-summary"><strong>{session.name}</strong><small>{session.email}</small></div>
      <Link role="menuitem" href="/profile" onClick={onClose}>{t('navigation.profile')}</Link>
      {session.membershipRole === 'OWNER' && <Link role="menuitem" href="/team" onClick={onClose}>{t('header.team')}</Link>}
      <button role="menuitem" type="button" disabled={loggingOut} onClick={() => void logout()}>{loggingOut ? t('header.signingOut') : t('header.signOut')}</button>
    </div>}
  </div>;
}

function usePopoverDismiss(open: boolean, root: RefObject<HTMLDivElement | null>, trigger: RefObject<HTMLButtonElement | null>, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const pointer = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) onClose(); };
    const keyboard = (event: KeyboardEvent) => { if (event.key === 'Escape') { onClose(); trigger.current?.focus(); } };
    document.addEventListener('mousedown', pointer); document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('mousedown', pointer); document.removeEventListener('keydown', keyboard); };
  }, [onClose, open, root, trigger]);
}

function relativeTime(value: string, t: ReturnType<typeof useI18n>['t']) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return t('header.justNow');
  if (minutes < 60) return t('header.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? t('header.hoursAgo', { count: hours }) : t('header.daysAgo', { count: Math.floor(hours / 24) });
}

function BellIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10.5 21a2 2 0 0 0 3 0" /></svg>; }
function SearchIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 4 4" /></svg>; }
