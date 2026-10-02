'use client';

import type { AdminOperationsSummary, AdminPlatformOverview } from '../../../../packages/contracts/src/auth';
import Link from 'next/link';

import { useI18n } from '../i18n/i18n-provider';
import { getAdminCopy } from './admin-copy';

export function AdminDashboard({ overview, operations }: { overview: AdminPlatformOverview; operations: AdminOperationsSummary }) {
  const { locale, formatDate, formatNumber } = useI18n();
  const text = getAdminCopy(locale);
  const metrics = [
    { label: text.dashboard.metrics.clients, value: overview.metrics.tenantCount, tone: 'accent' },
    { label: text.dashboard.metrics.active, value: overview.metrics.activeTenantCount, tone: 'success' },
    { label: text.dashboard.metrics.blocked, value: overview.metrics.blockedTenantCount, tone: 'danger' },
    { label: text.dashboard.metrics.users, value: overview.metrics.userCount, tone: 'neutral' },
    { label: text.dashboard.metrics.orders, value: overview.metrics.orderCount, tone: 'neutral' },
    { label: text.dashboard.metrics.newClients, value: overview.metrics.newTenantCount30Days, tone: 'accent' },
  ];
  const attentionQueues = operations.queues.filter((queue) => queue.status === 'ATTENTION');

  return <div className="admin-page">
    <header className="admin-page-heading">
      <div><span className="admin-eyebrow">{text.dashboard.eyebrow}</span><h1>{text.dashboard.title}</h1><p>{text.dashboard.description}</p></div>
      <div className="admin-page-state"><span className={`admin-status-pill status-${overview.status.toLowerCase()}`}>{overview.status === 'HEALTHY' ? text.dashboard.healthy : text.dashboard.degraded}</span><small>{text.dashboard.updated.replace('{date}', formatDate(overview.updatedAt, { dateStyle: 'medium', timeStyle: 'short' }))}</small></div>
    </header>

    <section className="admin-metric-grid" aria-label={text.dashboard.title}>{metrics.map((metric) => <article className={`admin-metric-card tone-${metric.tone}`} key={metric.label}><span>{metric.label}</span><strong>{formatNumber(metric.value)}</strong></article>)}</section>

    <section className="admin-dashboard-panels">
      <article className="admin-panel admin-clients-cta"><div className="admin-panel-icon" aria-hidden="true">↗</div><div><h2>{text.dashboard.metrics.clients}</h2><p>{locale === 'uk' ? 'Організації, доступ і безпечні агрегати використання.' : 'Organizations, access and safe usage aggregates.'}</p></div><Link className="secondary-button" href="/admin/tenants">{text.dashboard.clientsAction}</Link></article>
      <article className="admin-panel admin-operations-summary">
        <header><div><h2>{text.dashboard.operationsTitle}</h2><p>{text.dashboard.operationsDescription}</p></div><Link className="text-button" href="/admin/operations">{text.dashboard.operationsAction}</Link></header>
        {attentionQueues.length === 0
          ? <p className="admin-healthy-empty"><span aria-hidden="true">✓</span>{text.dashboard.allQueuesHealthy}</p>
          : <ul>{attentionQueues.map((queue) => <li key={queue.queue}><div><strong>{text.queues[queue.queue]}</strong><span>{text.dashboard.attention}</span></div><div className="admin-queue-facts"><span>{text.dashboard.waiting.replace('{count}', formatNumber(queue.waiting + queue.delayed))}</span><span>{text.dashboard.failed.replace('{count}', formatNumber(queue.failed))}</span><span>{text.dashboard.workers.replace('{count}', formatNumber(queue.workerCount))}</span></div></li>)}</ul>}
      </article>
    </section>
  </div>;
}
