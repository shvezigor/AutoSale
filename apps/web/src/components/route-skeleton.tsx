'use client';

import { useEffect, useState } from 'react';

import { useI18n } from '../i18n/i18n-provider';
import type { MessageKey } from '../i18n/translator';

type Section = 'orders' | 'orderDetail' | 'catalogue' | 'team' | 'settings' | 'conversations' | 'dashboard';
type Variant = 'table' | 'settings' | 'conversation' | 'detail' | 'dashboard';
type RouteSkeletonProps = { section: Section; variant: Variant };

const titleKeys: Record<Section, MessageKey> = {
  orders: 'orders.title',
  orderDetail: 'orders.title',
  catalogue: 'catalogue.title',
  team: 'team.title',
  settings: 'settings.title',
  conversations: 'conversations.title',
  dashboard: 'dashboard.title',
};

export function RouteSkeleton({ section, variant }: RouteSkeletonProps) {
  const { t } = useI18n();
  const [waitingLonger, setWaitingLonger] = useState(false);

  useEffect(() => {
    setWaitingLonger(false);
    const timer = window.setTimeout(() => setWaitingLonger(true), 3000);
    return () => window.clearTimeout(timer);
  }, [section]);

  return <main className={`route-skeleton route-skeleton-${variant}`} data-section={section} data-variant={variant}>
    <header className="route-skeleton-intro">
      <h1>{t(titleKeys[section])}</h1>
      <p role="status">{waitingLonger ? t('routeLoading.slow') : t(`routeLoading.${section}`)}</p>
    </header>
    <div aria-busy="true" className="route-skeleton-preview">
      <div aria-hidden="true">
        {variant === 'table' && <TablePreview />}
        {variant === 'settings' && <SettingsPreview />}
        {variant === 'conversation' && <ConversationPreview />}
        {variant === 'detail' && <DetailPreview />}
        {variant === 'dashboard' && <DashboardPreview />}
      </div>
    </div>
  </main>;
}

function TablePreview() {
  return <>
    <div className="route-skeleton-toolbar"><span /><span /><span /></div>
    <div className="route-skeleton-table">
      <div className="route-skeleton-table-row route-skeleton-table-head">{Array.from({ length: 6 }, (_, index) => <span key={index} />)}</div>
      {Array.from({ length: 5 }, (_, index) => <div className="route-skeleton-table-row" key={index}>
        {Array.from({ length: 6 }, (_, column) => <span key={column} />)}
      </div>)}
    </div>
  </>;
}

function SettingsPreview() {
  return <div className="route-skeleton-settings-list">
    {Array.from({ length: 3 }, (_, index) => <div className="route-skeleton-settings-card" key={index}>
      <span /><div><span /><span /></div><span />
    </div>)}
  </div>;
}

function ConversationPreview() {
  return <div className="route-skeleton-conversation-layout">
    <div className="route-skeleton-conversation-list">{Array.from({ length: 5 }, (_, index) => <div key={index}><span /><span /></div>)}</div>
    <div className="route-skeleton-conversation-thread"><span /><span /><span /></div>
  </div>;
}

function DetailPreview() {
  return <div className="route-skeleton-detail-layout">
    <div className="route-skeleton-detail-rail">{Array.from({ length: 5 }, (_, index) => <span key={index} />)}</div>
    <div className="route-skeleton-detail-card"><span /><span /><span /><span /></div>
  </div>;
}

function DashboardPreview() {
  return <>
    <div className="route-skeleton-metrics">{Array.from({ length: 4 }, (_, index) => <div data-dashboard-skeleton="metric" key={index}><span /><span /><span /></div>)}</div>
    <div className="route-skeleton-dashboard-panels"><div /><div /></div>
  </>;
}
