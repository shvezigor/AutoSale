import type { DashboardResponse } from '../../../../../packages/contracts/src/dashboard';
import Link from 'next/link';

import type { AppLocale } from '../../i18n/locales';
import type { Translator } from '../../i18n/translator';

type Props = {
  dailyOrders: DashboardResponse['dailyOrders'];
  funnel: DashboardResponse['funnel'];
  locale: AppLocale;
  t: Translator;
};

type DailyStatus = 'confirmed' | 'needsReview' | 'processingOrFailed' | 'cancelled';
type FunnelStage = 'created' | 'confirmed' | 'exported' | 'shipmentStarted';

const statuses: DailyStatus[] = ['confirmed', 'needsReview', 'processingOrFailed', 'cancelled'];
const funnelStages: FunnelStage[] = ['created', 'confirmed', 'exported', 'shipmentStarted'];

export function DashboardCharts({ dailyOrders, funnel, locale, t }: Props) {
  const number = new Intl.NumberFormat(locale === 'en' ? 'en-GB' : 'uk-UA');
  const date = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'uk-UA', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  const shortDate = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'uk-UA', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  const maxTotal = Math.max(1, ...dailyOrders.map((day) => statuses.reduce((total, status) => total + day[status], 0)));

  return (
    <section className="dashboard-analytics-grid">
      <article className="dashboard-chart-card">
        <header className="dashboard-card-heading">
          <div><span>{t('dashboard.chart.eyebrow')}</span><h2>{t('dashboard.chart.title')}</h2></div>
          <Link href="/orders">{t('dashboard.chart.allOrders')}<span aria-hidden="true"> →</span></Link>
        </header>
        <div className="dashboard-chart-legend" aria-label={t('dashboard.chart.legend')}>
          {statuses.map((status) => <span className={`is-${status}`} key={status}><i aria-hidden="true" />{t(`dashboard.chart.status.${status}`)}</span>)}
        </div>
        {dailyOrders.length === 0 ? (
          <div className="dashboard-chart-empty"><span aria-hidden="true">↗</span><p>{t('dashboard.chart.empty')}</p></div>
        ) : (
          <>
            <div className={`dashboard-stacked-chart${dailyOrders.length > 31 ? ' is-dense' : ''}`}>
              {dailyOrders.map((day) => {
                const label = date.format(parseDate(day.date));
                return (
                  <div className="dashboard-chart-column" key={day.date}>
                    <div className="dashboard-chart-bar" style={{ height: `${Math.max(10, statuses.reduce((sum, status) => sum + day[status], 0) / maxTotal * 100)}%` }}>
                      {statuses.map((status) => day[status] > 0 ? (
                        <button
                          aria-label={t('dashboard.chart.datum', { count: number.format(day[status]), date: label, status: t(`dashboard.chart.status.${status}`) })}
                          className={`is-${status}`}
                          data-tooltip={t('dashboard.chart.tooltip', { count: number.format(day[status]), status: t(`dashboard.chart.status.${status}`) })}
                          key={status}
                          style={{ flexGrow: day[status] }}
                          tabIndex={0}
                          type="button"
                        />
                      ) : null)}
                    </div>
                    <span>{shortDate.format(parseDate(day.date))}</span>
                  </div>
                );
              })}
            </div>
            <table aria-label={t('dashboard.chart.tableLabel')} className="sr-only">
              <thead><tr><th>{t('dashboard.chart.date')}</th>{statuses.map((status) => <th key={status}>{t(`dashboard.chart.status.${status}`)}</th>)}</tr></thead>
              <tbody>{dailyOrders.map((day) => <tr key={day.date}><th>{date.format(parseDate(day.date))}</th>{statuses.map((status) => <td key={status}>{day[status]}</td>)}</tr>)}</tbody>
            </table>
          </>
        )}
      </article>

      <article className="dashboard-funnel-card">
        <header className="dashboard-card-heading"><div><span>{t('dashboard.funnel.eyebrow')}</span><h2>{t('dashboard.funnel.title')}</h2></div></header>
        <p className="dashboard-funnel-description">{t('dashboard.funnel.description')}</p>
        <ol className="dashboard-funnel-list">
          {funnelStages.map((stage, index) => {
            const value = funnel[stage];
            const unavailable = stage === 'exported' && (!funnel.exportConfigured || value === null);
            const rate = value === null || funnel.created === 0 ? null : Math.round(value / funnel.created * 100);
            const width = rate === null ? 100 : Math.max(rate, 8);
            return (
              <li data-stage={stage} data-testid="funnel-stage" key={stage}>
                <div className="dashboard-funnel-label"><span><i>{index + 1}</i>{t(`dashboard.funnel.stages.${stage}`)}</span>{unavailable ? <em>{t('dashboard.funnel.notConfigured')}</em> : <><strong data-funnel-value>{number.format(value ?? 0)}</strong><small data-funnel-rate>{rate}%</small></>}</div>
                <div className={`dashboard-funnel-track${unavailable ? ' is-unavailable' : ''}`}><span style={{ width: `${width}%` }} /></div>
                {unavailable ? <Link href="/settings?tab=data">{t('dashboard.funnel.configureExport')}</Link> : null}
              </li>
            );
          })}
        </ol>
      </article>
    </section>
  );
}

function parseDate(value: string): Date {
  return new Date(`${value}T12:00:00.000Z`);
}
