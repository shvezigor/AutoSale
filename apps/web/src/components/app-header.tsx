'use client';

import type { PublicSession } from '../../../../packages/contracts/src/auth';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';

import { getNotifications, markAllNotificationsRead, markNotificationRead, type NotificationItem } from '../api/notifications';
import { mutatingFetch } from '../auth/csrf-fetch';

type HeaderSession = Pick<PublicSession, 'name' | 'email' | 'membershipRole'>;

export function AppHeader({ session }: { session: HeaderSession }) {
  const [open, setOpen] = useState<'notifications' | 'profile' | null>(null);
  return <header className="app-header">
    <span className="app-header-context">Робочий простір</span>
    <div className="app-header-actions">
      <NotificationCenter open={open === 'notifications'} onToggle={() => setOpen((value) => value === 'notifications' ? null : 'notifications')} onClose={() => setOpen(null)} />
      <ProfileMenu session={session} open={open === 'profile'} onToggle={() => setOpen((value) => value === 'profile' ? null : 'profile')} onClose={() => setOpen(null)} />
    </div>
  </header>;
}

function NotificationCenter({ open, onToggle, onClose }: { open: boolean; onToggle(): void; onClose(): void }) {
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
    <button ref={trigger} className="header-icon-button" type="button" aria-label={unreadCount ? `Сповіщення: ${unreadCount} непрочитаних` : 'Сповіщення'} aria-expanded={open} aria-controls="notification-popover" onClick={onToggle}>
      <BellIcon />{unreadCount > 0 && <span className="notification-badge" aria-hidden="true">{unreadCount > 99 ? '99+' : unreadCount}</span>}
    </button>
    {open && <section id="notification-popover" className="header-popover notification-popover" aria-label="Центр сповіщень">
      <header><div><strong>Сповіщення</strong><span>{unreadCount ? `${unreadCount} непрочитаних` : 'Усе переглянуто'}</span></div>{unreadCount > 0 && <button type="button" onClick={() => void readAll()}>Прочитати всі</button>}</header>
      {status === 'loading' && <div className="popover-state" aria-busy="true">Завантажуємо…</div>}
      {status === 'error' && <div className="popover-state" role="alert">Не вдалося завантажити.<button type="button" onClick={() => void load()}>Повторити</button></div>}
      {status === 'ready' && items.length === 0 && <div className="popover-state">Нових подій поки немає.</div>}
      {status === 'ready' && items.length > 0 && <ul className="notification-list">{items.map((item) => <li key={item.id} data-unread={!item.readAt}>
        {item.actionUrl ? <Link href={item.actionUrl} onClick={() => { void readOne(item); onClose(); }}><NotificationCopy item={item} /></Link> : <button type="button" onClick={() => void readOne(item)}><NotificationCopy item={item} /></button>}
      </li>)}</ul>}
    </section>}
  </div>;
}

function NotificationCopy({ item }: { item: NotificationItem }) {
  return <><span className={`notification-dot type-${item.type.toLowerCase()}`} aria-hidden="true" /><span><strong>{item.title}</strong>{item.message && <small>{item.message}</small>}<time dateTime={item.createdAt}>{relativeTime(item.createdAt)}</time></span></>;
}

function ProfileMenu({ session, open, onToggle, onClose }: { session: HeaderSession; open: boolean; onToggle(): void; onClose(): void }) {
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
    <button ref={trigger} className="profile-trigger" type="button" aria-label="Меню профілю" aria-expanded={open} aria-controls="profile-popover" onClick={onToggle}>
      <span className="manager-avatar">{session.name.slice(0, 1).toUpperCase()}</span><span className="profile-trigger-copy"><strong>{session.name}</strong><small>{session.membershipRole === 'OWNER' ? 'Власник' : 'Менеджер'}</small></span><span aria-hidden="true">⌄</span>
    </button>
    {open && <div id="profile-popover" className="header-popover profile-popover" role="menu">
      <div className="profile-summary"><strong>{session.name}</strong><small>{session.email}</small></div>
      <Link role="menuitem" href="/settings" onClick={onClose}>Налаштування</Link>
      {session.membershipRole === 'OWNER' && <Link role="menuitem" href="/team" onClick={onClose}>Команда</Link>}
      <button role="menuitem" type="button" disabled={loggingOut} onClick={() => void logout()}>{loggingOut ? 'Виходимо…' : 'Вийти'}</button>
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

function relativeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return 'щойно';
  if (minutes < 60) return `${minutes} хв тому`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} год тому` : `${Math.floor(hours / 24)} дн тому`;
}

function BellIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>; }
