'use client';

import type { AdminOperationsSummary, AdminQueueSummary } from '../../../../packages/contracts/src/auth';

import { useI18n } from '../i18n/i18n-provider';
import { getAdminCopy } from './admin-copy';

export function AdminOperations({ summary }: { summary: AdminOperationsSummary }) {
  const { locale, formatDate, formatNumber } = useI18n();
  const copy = getAdminCopy(locale);
  const text = copy.operations;

  return <div className="admin-page">
    <header className="admin-page-heading"><div><span className="admin-eyebrow">{text.eyebrow}</span><h1>{text.title}</h1><p>{text.description}</p></div><div className="admin-page-state"><span className={`admin-status-pill status-${summary.status.toLowerCase()}`}>{summary.status === 'HEALTHY' ? text.healthy : text.degraded}</span><small>{text.updated.replace('{date}', formatDate(summary.updatedAt, { dateStyle: 'medium', timeStyle: 'short' }))}</small></div></header>
    <section className="admin-service-grid" aria-label={text.title}>
      <ServiceCard name="API" description={text.apiDescription} status={text.healthy} />
      <ServiceCard name="PostgreSQL" description={text.databaseDescription} status={text.healthy} />
    </section>
    <section className="admin-panel admin-queue-panel"><header><div><h2>{text.queuesTitle}</h2><p>{text.queuesDescription}</p></div></header><div className="admin-table-wrap"><table className="admin-data-table admin-queue-table"><thead><tr>{Object.values(text.columns).map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{summary.queues.map((queue) => <tr key={queue.queue}>
      <td data-label={text.columns.queue}><strong>{copy.queues[queue.queue]}</strong></td><td data-label={text.columns.status}><QueueStatus queue={queue} text={text} /></td><td data-label={text.columns.waiting}>{formatNumber(queue.waiting)}</td><td data-label={text.columns.active}>{formatNumber(queue.active)}</td><td data-label={text.columns.delayed}>{formatNumber(queue.delayed)}</td><td data-label={text.columns.failed}>{formatNumber(queue.failed)}</td><td data-label={text.columns.completed}>{formatNumber(queue.completed)}</td><td data-label={text.columns.workers}>{formatNumber(queue.workerCount)}</td><td data-label={text.columns.oldest}>{queue.oldestPendingAt ? formatDate(queue.oldestPendingAt, { dateStyle: 'short', timeStyle: 'short' }) : text.none}</td>
    </tr>)}</tbody></table></div></section>
  </div>;
}

function ServiceCard({ name, description, status }: { name: string; description: string; status: string }) {
  return <article className="admin-service-card"><span className="admin-service-indicator" aria-hidden="true" /><div><strong>{name}</strong><small>{description}</small></div><span className="admin-access-status">{status}</span></article>;
}

function QueueStatus({ queue, text }: { queue: AdminQueueSummary; text: ReturnType<typeof getAdminCopy>['operations'] }) {
  if (!queue.available) return <span className="admin-access-status status-blocked">{text.unavailable}</span>;
  if (queue.status === 'ATTENTION') return <span className="admin-access-status status-attention">{text.degraded}</span>;
  if (queue.status === 'IDLE') return <span className="admin-access-status status-idle">{text.idle}</span>;
  return <span className="admin-access-status">{text.healthy}</span>;
}
