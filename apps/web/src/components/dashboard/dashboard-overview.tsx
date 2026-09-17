import type { DashboardResponse } from '../../../../../packages/contracts/src/dashboard';
import Link from 'next/link';
import type { SVGProps } from 'react';

import type { AppLocale } from '../../i18n/locales';
import type { Translator } from '../../i18n/translator';

type Props = {
  locale: AppLocale;
  metrics: DashboardResponse['metrics'];
  t: Translator;
};

type MetricKey = 'newOrders' | 'needsAttention' | 'confirmationRate' | 'confirmationTime';

export function DashboardOverview({ locale, metrics, t }: Props) {
  const number = new Intl.NumberFormat(locale === 'en' ? 'en-GB' : 'uk-UA');
  const cards: Array<{ key: MetricKey; value: string; detail: string; change: number | null; inverse?: boolean }> = [
    {
      key: 'newOrders',
      value: number.format(metrics.newOrders.value),
      detail: metrics.newOrders.changePercent === null ? t('dashboard.metrics.noComparison') : t('dashboard.metrics.comparedWithPrevious'),
      change: metrics.newOrders.changePercent,
    },
    {
      key: 'needsAttention',
      value: number.format(metrics.needsAttention.value),
      detail: metrics.needsAttention.overdue > 0
        ? t('dashboard.metrics.overdue', { count: number.format(metrics.needsAttention.overdue) })
        : t('dashboard.metrics.currentState'),
      change: null,
    },
    {
      key: 'confirmationRate',
      value: metrics.confirmationRate.value === null ? t('dashboard.unavailable') : `${number.format(Math.round(metrics.confirmationRate.value * 100))}%`,
      detail: metrics.confirmationRate.changePercentagePoints === null ? t('dashboard.metrics.noComparison') : t('dashboard.metrics.comparedWithPrevious'),
      change: metrics.confirmationRate.changePercentagePoints,
    },
    {
      key: 'confirmationTime',
      value: formatDuration(metrics.medianConfirmationMinutes.value, number, t),
      detail: metrics.medianConfirmationMinutes.changePercent === null
        ? t('dashboard.metrics.noComparison')
        : t('dashboard.metrics.samples', { count: number.format(metrics.medianConfirmationMinutes.sampleSize) }),
      change: metrics.medianConfirmationMinutes.changePercent,
      inverse: true,
    },
  ];

  return (
    <section className={`dashboard-overview${metrics.needsAttention.value === 0 ? ' is-clear' : ''}`}>
      {metrics.needsAttention.value > 0 ? (
        <article className="dashboard-attention-card">
          <span className="dashboard-attention-eyebrow"><span aria-hidden="true">AI</span>{t('dashboard.attention.eyebrow')}</span>
          <h2>{t('dashboard.attention.title', { count: number.format(metrics.needsAttention.value) })}</h2>
          <p>{t('dashboard.attention.description')}</p>
          <div className="dashboard-attention-actions">
            {metrics.needsAttention.review > 0 ? <Link href="/orders?status=NEEDS_REVIEW">{t('dashboard.attention.openQueue')}</Link> : null}
            {metrics.needsAttention.aiFailed > 0 ? <Link className="is-secondary" href="/orders?status=AI_FAILED">{t('dashboard.attention.aiFailed', { count: number.format(metrics.needsAttention.aiFailed) })}</Link> : null}
          </div>
        </article>
      ) : null}
      <div className="dashboard-live-metrics">
        {cards.map((card) => {
          const tone = card.change === null ? 'neutral' : (card.inverse ? card.change <= 0 : card.change >= 0) ? 'positive' : 'negative';
          return (
            <article className="dashboard-live-metric" key={card.key}>
              <span className={`dashboard-live-metric-icon is-${card.key}`} aria-hidden="true"><MetricIcon metric={card.key} /></span>
              <h2>{t(`dashboard.metrics.${card.key}`)}</h2>
              <strong>{card.value}</strong>
              <div className="dashboard-live-metric-foot">
                {card.change === null || card.key === 'needsAttention'
                  ? <span>{card.detail}</span>
                  : <><b data-tone={tone}>{formatChange(card.change, number)}</b><span>{card.detail}</span></>}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function formatDuration(value: number | null, number: Intl.NumberFormat, t: Translator): string {
  if (value === null) return t('dashboard.unavailable');
  if (value < 120) return t('dashboard.minutes', { count: number.format(Math.round(value)) });
  return t('dashboard.hours', { count: number.format(Math.round(value / 6) / 10) });
}

function formatChange(value: number, number: Intl.NumberFormat): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${number.format(Math.abs(value))}%`;
}

function MetricIcon({ metric }: { metric: MetricKey }) {
  const common: SVGProps<SVGSVGElement> = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (metric === 'newOrders') return <svg {...common}><path d="M6 5h12v16H6zM9 3h6v4H9z" /><path d="M9 12h6M9 16h4" /></svg>;
  if (metric === 'needsAttention') return <svg {...common}><path d="M12 3 3 20h18L12 3Z" /><path d="M12 9v5M12 17h.01" /></svg>;
  if (metric === 'confirmationRate') return <svg {...common}><path d="m5 12 4 4L19 6" /></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
}
