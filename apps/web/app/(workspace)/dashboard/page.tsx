import Link from 'next/link';
import type { SVGProps } from 'react';

import { getServerSession } from '../../../src/auth/session';
import { dashboardMetrics, dashboardMonthlyRevenue, dashboardQueue, dashboardSources, type DashboardMetricKey } from '../../../src/components/dashboard-fixtures';
import { createTranslator } from '../../../src/i18n/translator';

export default async function DashboardPage() {
  const session = await getServerSession();
  const t = createTranslator(session?.locale ?? 'uk');
  const months = t('dashboard.months').split(',');

  return (
    <main className="dashboard-page">
      <header className="dashboard-title-row">
        <div>
          <span className="dashboard-eyebrow">{t('dashboard.demo')}</span>
          <h1>{t('dashboard.title')}</h1>
          <p>{t('dashboard.description')}</p>
        </div>
      </header>

      <section className="dashboard-summary" aria-label={t('dashboard.summaryLabel')}>
        <article className="dashboard-ai-card">
          <span className="dashboard-ai-badge">AI</span>
          <h2>{t('dashboard.aiTitle')}</h2>
          <p>{t('dashboard.aiDescription')}</p>
          <Link href="/orders?status=NEEDS_REVIEW" className="dashboard-queue-cta">
            {t('dashboard.openQueue')}
          </Link>
        </article>

        <div className="dashboard-metrics">
          {dashboardMetrics.map((metric) => (
            <article className="dashboard-metric-card" key={metric.key}>
              <div className={`dashboard-metric-icon dashboard-metric-icon-${metric.tone}`} aria-hidden="true">
                <MetricIcon metric={metric.key} />
              </div>
              <h2>{t(`dashboard.metrics.${metric.key}`)}</h2>
              <strong>{metric.value}</strong>
              <span className={metric.tone === 'red' ? 'dashboard-trend-alert' : 'dashboard-trend-positive'}>{metric.trend}</span>
              <svg className="dashboard-sparkline" viewBox="0 0 96 34" role="img" aria-label={t('dashboard.trendLabel')}>
                <polyline points={metric.sparkline} />
              </svg>
            </article>
          ))}
        </div>
      </section>

      <section className="dashboard-analytics-panel">
        <article className="dashboard-revenue-chart">
          <div className="dashboard-panel-heading">
            <div><h2>{t('dashboard.revenueTitle')}</h2><strong>5 800 ₴</strong><span>+10,6%</span></div>
            <span className="dashboard-period">{t('dashboard.month')}</span>
          </div>
          <div className="dashboard-bars" aria-label={t('dashboard.revenueChartLabel')}>
            {dashboardMonthlyRevenue.map((height, index) => (
              <div className="dashboard-bar-column" key={months[index]}>
                <span className={index === 5 ? 'dashboard-bar is-highlighted' : 'dashboard-bar'} style={{ height: `${height}%` }} />
                <small>{months[index]}</small>
              </div>
            ))}
          </div>
        </article>

        <article className="dashboard-sources">
          <h2>{t('dashboard.sourcesTitle')}</h2>
          <div className="dashboard-sources-content">
            <div className="dashboard-donut" role="img" aria-label={t('dashboard.sourcesChartLabel')}><strong>34</strong></div>
            <ul>
              {dashboardSources.map((source) => <li key={source.label}><span className={`source-dot source-${source.tone}`} /><span>{source.label}</span><strong>{source.value}%</strong></li>)}
            </ul>
          </div>
        </article>
      </section>

      <section className="dashboard-queue-panel">
        <div className="dashboard-panel-heading"><div><h2>{t('dashboard.queueTitle')}</h2><p>{t('dashboard.queueDescription')}</p></div><Link href="/orders?status=NEEDS_REVIEW">{t('dashboard.allOrders')}</Link></div>
        <div className="dashboard-queue-list">
          {dashboardQueue.map((item) => (
            <article key={item.product}>
              <div><strong>{item.product}</strong><span>{item.customer} · {item.confidence}</span></div>
              <div className="dashboard-queue-actions"><span>{t(`dashboard.queueActions.${item.action}`)}</span><Link href="/orders?status=NEEDS_REVIEW">{t('dashboard.open')}</Link></div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function MetricIcon({ metric }: { metric: DashboardMetricKey }) {
  const common: SVGProps<SVGSVGElement> = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor' };
  if (metric === 'orders') return <svg {...common}><path d="M6 5h12v16H6zM9 3h6v4H9z" /></svg>;
  if (metric === 'dialogs') return <svg {...common}><path d="M19 8a8 8 0 1 0 1 7M19 3v5h-5" /></svg>;
  if (metric === 'average') return <svg {...common}><circle cx="12" cy="12" r="8" /><path d="M12 8v8M8 12h8" /></svg>;
  return <svg {...common}><path d="M5 18V9M10 18V5M15 18v-7M20 18V3" /></svg>;
}
