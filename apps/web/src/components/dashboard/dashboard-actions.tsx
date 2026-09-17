import type { DashboardResponse } from '../../../../../packages/contracts/src/dashboard';
import Link from 'next/link';

import type { AppLocale } from '../../i18n/locales';
import type { Translator } from '../../i18n/translator';

type Props = Pick<DashboardResponse, 'generatedAt' | 'integrations' | 'issues' | 'queue'> & {
  locale: AppLocale;
  t: Translator;
};

export function DashboardActions({ generatedAt, integrations, issues, locale, queue, t }: Props) {
  const number = new Intl.NumberFormat(locale === 'en' ? 'en-GB' : 'uk-UA');

  return (
    <section className="dashboard-actions-grid">
      <article className="dashboard-queue-card">
        <header className="dashboard-card-heading">
          <div><span>{t('dashboard.actions.priority')}</span><h2>{t('dashboard.actions.queueTitle')}</h2></div>
          <Link href="/orders?status=NEEDS_REVIEW">{t('dashboard.actions.openAll')}<span aria-hidden="true"> →</span></Link>
        </header>
        {queue.length === 0 ? (
          <div className="dashboard-queue-empty"><span aria-hidden="true">✓</span><p>{t('dashboard.actions.queueEmpty')}</p></div>
        ) : (
          <ul className="dashboard-action-queue">
            {queue.slice(0, 5).map((order) => {
              const participant = order.participantName ?? t('dashboard.actions.unknownCustomer');
              const product = order.productLabel ?? t('dashboard.actions.unknownProduct');
              return (
                <li key={order.id}>
                  <Link href={`/orders/${order.id}`}>
                    <span className={`dashboard-queue-status is-${order.status.toLowerCase()}`} aria-hidden="true">{order.status === 'AI_FAILED' ? '!' : '↗'}</span>
                    <span className="dashboard-queue-copy"><strong>{participant}</strong><small>{product}</small></span>
                    <span className="dashboard-queue-meta"><em>{formatAge(order.createdAt, generatedAt, number, t)}</em>{order.confidence === null ? <small>{t(`dashboard.actions.status.${order.status}`)}</small> : <small>{t('dashboard.actions.confidence', { count: number.format(Math.round(order.confidence * 100)) })}</small>}</span>
                    <span className="dashboard-queue-arrow" aria-hidden="true">›</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </article>

      <div className="dashboard-side-stack">
        <article className="dashboard-issues-card">
          <header className="dashboard-card-heading"><div><span>{t('dashboard.actions.control')}</span><h2>{t('dashboard.actions.issuesTitle')}</h2></div></header>
          <div className="dashboard-issue-list">
            <Issue count={issues.failedExports} href="/settings?tab=data" label={t('dashboard.actions.failedExports')} link={t('dashboard.actions.checkExports')} number={number} tone="export" />
            <Issue count={issues.failedShipments} href="/orders?shipmentStatus=FAILED" label={t('dashboard.actions.failedShipments')} link={t('dashboard.actions.checkShipments')} number={number} tone="shipment" />
          </div>
        </article>

        <article className="dashboard-integrations-card">
          <header className="dashboard-card-heading"><div><span>{t('dashboard.actions.connections')}</span><h2>{t('dashboard.actions.integrationsTitle')}</h2></div></header>
          <ul className="dashboard-integration-list">
            {integrations.map((integration) => (
              <li key={integration.key}>
                <Link href={integration.href}>
                  <span className={`dashboard-integration-mark is-${integration.key}`} aria-hidden="true">{integrationMark(integration.key)}</span>
                  <span><strong>{integration.label}</strong>{integration.detail ? <small>{integration.detail}</small> : null}</span>
                  <em className={`is-${integration.state}`}><i aria-hidden="true" />{t(`dashboard.actions.integrationState.${integration.state}`)}</em>
                  <span aria-hidden="true">›</span>
                </Link>
              </li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  );
}

function Issue({ count, href, label, link, number, tone }: { count: number; href: string; label: string; link: string; number: Intl.NumberFormat; tone: 'export' | 'shipment' }) {
  return <div className={`dashboard-issue is-${tone}${count === 0 ? ' is-clear' : ''}`}><span aria-hidden="true">{count === 0 ? '✓' : '!'}</span><div><strong data-issue-count>{number.format(count)}</strong><small>{label}</small></div><Link href={href}>{link}<span aria-hidden="true"> →</span></Link></div>;
}

function formatAge(createdAt: string, generatedAt: string, number: Intl.NumberFormat, t: Translator): string {
  const elapsedHours = Math.max(0, Math.floor((new Date(generatedAt).getTime() - new Date(createdAt).getTime()) / 3_600_000));
  if (elapsedHours < 1) return t('dashboard.actions.justNow');
  if (elapsedHours < 24) return t('dashboard.actions.hoursAgo', { count: number.format(elapsedHours) });
  return t('dashboard.actions.daysAgo', { count: number.format(Math.floor(elapsedHours / 24)) });
}

function integrationMark(key: DashboardResponse['integrations'][number]['key']): string {
  return ({ instagram: 'IG', 'google-sheets': 'G', 'nova-poshta': 'НП', meest: 'M', ukrposhta: 'УП' })[key];
}
