'use client';

import type { PublicSession } from '../../../../packages/contracts/src/auth';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentType, SVGProps } from 'react';

type NavigationSession = Pick<PublicSession, 'name' | 'email' | 'membershipRole'>;
type NavigationIcon = ComponentType<SVGProps<SVGSVGElement>>;

type NavigationItem = {
  href: string;
  label: string;
  icon: NavigationIcon;
  ownerOnly?: boolean;
  requiresMembership?: boolean;
};

const navigationItems: NavigationItem[] = [
  { href: '/conversations', label: 'Діалоги', icon: ConversationIcon },
  { href: '/orders', label: 'Замовлення', icon: OrdersIcon },
  { href: '/catalogue', label: 'Каталог', icon: CatalogueIcon, requiresMembership: true },
  { href: '/team', label: 'Команда', icon: TeamIcon, ownerOnly: true },
  { href: '/settings', label: 'Налаштування', icon: SettingsIcon, requiresMembership: true },
];

export function isNavigationItemActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PrimaryNavigation({
  session,
  ariaLabel = 'Головна навігація',
  className = '',
  navId,
  onNavigate,
  collapsed = false,
  onToggleCollapse,
}: {
  session: NavigationSession;
  ariaLabel?: string;
  className?: string;
  navId?: string;
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const pathname = usePathname();
  const navigationHandler = onNavigate ? { onClick: onNavigate } : {};
  const visibleItems = navigationItems.filter((item) => {
    if (item.ownerOnly) return session.membershipRole === 'OWNER';
    if (item.requiresMembership) return Boolean(session.membershipRole);
    return true;
  });

  return <aside className={`primary-nav ${className}`.trim()}>
    <div className="primary-nav-brand-row">
      <Link className="brand" href="/conversations" {...navigationHandler}><span className="brand-mark" aria-hidden="true">A</span><span className="brand-label">AutoSale</span></Link>
      {onToggleCollapse && <button className="sidebar-toggle" type="button" aria-label={collapsed ? 'Розгорнути меню' : 'Згорнути меню'} aria-expanded={!collapsed} onClick={onToggleCollapse}><CollapseIcon data-collapsed={collapsed} /></button>}
    </div>
    <nav aria-label={ariaLabel} id={navId}>
      {visibleItems.map((item) => {
        const Icon = item.icon;
        const active = isNavigationItemActive(pathname, item.href);
        return <Link className={`nav-item${active ? ' active' : ''}`} href={item.href} aria-current={active ? 'page' : undefined} {...navigationHandler} key={item.href}>
          <Icon className="nav-icon" aria-hidden="true" />
          <span className="nav-label">{item.label}</span>
          <span className="nav-tooltip" aria-hidden="true">{item.label}</span>
        </Link>;
      })}
    </nav>
  </aside>;
}

function ConversationIcon(props: SVGProps<SVGSVGElement>) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}><path d="M5 5h14v10H9l-4 4V5Z" /><path d="M8 9h8M8 12h5" /></svg>; }
function OrdersIcon(props: SVGProps<SVGSVGElement>) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}><path d="M6 7h12l-1 13H7L6 7Z" /><path d="M9 9V5a3 3 0 0 1 6 0v4" /></svg>; }
function CatalogueIcon(props: SVGProps<SVGSVGElement>) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}><path d="M4 5.5 12 2l8 3.5v13L12 22l-8-3.5v-13Z" /><path d="m4 5.5 8 3.5 8-3.5M12 9v13" /></svg>; }
function TeamIcon(props: SVGProps<SVGSVGElement>) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}><circle cx="9" cy="8" r="3" /><path d="M3.5 19c.4-4 2.2-6 5.5-6s5.1 2 5.5 6M16 5.5a3 3 0 0 1 0 5.5M16 13c2.8.3 4.3 2.3 4.5 6" /></svg>; }
function SettingsIcon(props: SVGProps<SVGSVGElement>) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}><circle cx="12" cy="12" r="3" /><path d="M19 13.5v-3l-2.2-.7-.7-1.6 1-2-2.2-2.1-2 1-1.7-.7L10.5 2h-3l-.7 2.4-1.6.7-2-1L1.1 6.2l1 2-.7 1.6-2.4.7v3l2.4.7.7 1.6-1 2 2.1 2.1 2-1 1.6.7.7 2.4h3l.7-2.4 1.7-.7 2 1 2.2-2.1-1-2 .7-1.6 2.2-.7Z" transform="translate(2) scale(.83 1)" /></svg>; }
function CollapseIcon({ 'data-collapsed': collapsed }: { 'data-collapsed': boolean }) { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d={collapsed ? 'm9 6 6 6-6 6' : 'm15 6-6 6 6 6'} /></svg>; }
