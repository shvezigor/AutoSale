'use client';

import type { PublicSession } from '../../../../packages/contracts/src/auth';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentType, SVGProps } from 'react';
import { useI18n } from '../i18n/i18n-provider';

type NavigationSession = Pick<PublicSession, 'name' | 'email' | 'membershipRole'>;
type NavigationIcon = ComponentType<SVGProps<SVGSVGElement>>;

type NavigationItem = {
  href: string;
  labelKey: 'navigation.dashboard' | 'navigation.conversations' | 'navigation.orders' | 'navigation.catalogue' | 'navigation.team' | 'navigation.settings' | 'navigation.onboarding';
  icon: NavigationIcon;
  ownerOnly?: boolean;
  requiresMembership?: boolean;
};

const navigationItems: NavigationItem[] = [
  { href: '/dashboard', labelKey: 'navigation.dashboard', icon: DashboardIcon },
  { href: '/conversations', labelKey: 'navigation.conversations', icon: ConversationIcon },
  { href: '/orders', labelKey: 'navigation.orders', icon: OrdersIcon },
  { href: '/catalogue', labelKey: 'navigation.catalogue', icon: CatalogueIcon, requiresMembership: true },
  { href: '/team', labelKey: 'navigation.team', icon: TeamIcon, ownerOnly: true },
  { href: '/settings', labelKey: 'navigation.settings', icon: SettingsIcon, requiresMembership: true },
  { href: '/onboarding', labelKey: 'navigation.onboarding', icon: OnboardingIcon, requiresMembership: true },
];

export function isNavigationItemActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PrimaryNavigation({
  session,
  ariaLabel,
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
  const { t } = useI18n();
  const navigationHandler = onNavigate ? { onClick: onNavigate } : {};
  const visibleItems = navigationItems.filter((item) => {
    if (item.ownerOnly) return session.membershipRole === 'OWNER';
    if (item.requiresMembership) return Boolean(session.membershipRole);
    return true;
  });

  return <aside className={`primary-nav ${className}`.trim()}>
    <div className="primary-nav-brand-row">
      <Link className="brand" href="/dashboard" aria-label="AutoSale" {...navigationHandler}><span className="brand-mark" aria-hidden="true">A</span><span className="brand-label">AutoSale</span></Link>
      {onToggleCollapse && <button className="sidebar-toggle" type="button" aria-label={collapsed ? t('navigation.expand') : t('navigation.collapse')} aria-expanded={!collapsed} onClick={onToggleCollapse}><CollapseIcon data-collapsed={collapsed} /></button>}
    </div>
    <nav aria-label={ariaLabel ?? t('navigation.mainLabel')} id={navId}>
      {visibleItems.map((item) => {
        const Icon = item.icon;
        const active = isNavigationItemActive(pathname, item.href);
        const label = t(item.labelKey);
        return <Link className={`nav-item${active ? ' active' : ''}`} href={item.href} aria-label={collapsed ? label : undefined} aria-current={active ? 'page' : undefined} {...navigationHandler} key={item.href}>
          <span className="nav-icon-frame" aria-hidden="true"><Icon className="nav-icon" /></span>
          <span className="nav-label">{label}</span>
          <span className="nav-tooltip" aria-hidden="true">{label}</span>
        </Link>;
      })}
    </nav>
  </aside>;
}

function DashboardIcon(props: SVGProps<SVGSVGElement>) { return <svg data-icon="dashboard" viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></svg>; }
function ConversationIcon(props: SVGProps<SVGSVGElement>) { return <svg data-icon="conversations" viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}><path d="M20 15a3 3 0 0 1-3 3H8l-4 3V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3Z" /><path d="M9 10h.01M12.5 10h.01M16 10h.01" /></svg>; }
function OrdersIcon(props: SVGProps<SVGSVGElement>) { return <svg data-icon="orders" viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}><path d="M6 2h12l1 4H5Z" /><path d="M5 6h14l-1.2 14.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8Z" /><path d="M9.5 11a2.5 2.5 0 0 0 5 0" /></svg>; }
function CatalogueIcon(props: SVGProps<SVGSVGElement>) { return <svg data-icon="catalogue" viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}><path d="m21 8-9-5-9 5 9 5Z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></svg>; }
function TeamIcon(props: SVGProps<SVGSVGElement>) { return <svg data-icon="team" viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}><circle cx="9" cy="8" r="3.4" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 5.2a3.4 3.4 0 0 1 0 5.6M18 20a6.6 6.6 0 0 0-2.4-5.1" /></svg>; }
function SettingsIcon(props: SVGProps<SVGSVGElement>) { return <svg data-icon="settings" viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.1a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1A2 2 0 1 1 4.1 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14h-.1a2 2 0 1 1 0-4H3a1.7 1.7 0 0 0 1.5-1.1A1.7 1.7 0 0 0 4.2 7l-.1-.1A2 2 0 1 1 6.9 4l.1.1a1.7 1.7 0 0 0 1.9.3H9A1.7 1.7 0 0 0 10 3v-.1a2 2 0 1 1 4 0V3a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1h.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></svg>; }
function OnboardingIcon(props: SVGProps<SVGSVGElement>) { return <svg data-icon="onboarding" viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}><path d="M9 2v6M15 2v6" /><path d="M6 8h12v4a6 6 0 0 1-6 6 6 6 0 0 1-6-6Z" /><path d="M12 18v4" /></svg>; }
function CollapseIcon({ 'data-collapsed': collapsed }: { 'data-collapsed': boolean }) { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d={collapsed ? 'm9 6 6 6-6 6' : 'm15 6-6 6 6 6'} /></svg>; }
