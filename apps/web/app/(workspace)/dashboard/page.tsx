import type { DashboardPeriod } from '../../../../../packages/contracts/src/dashboard';
import Link from 'next/link';

import { getDashboard } from '../../../src/api/dashboard';
import { getServerSession } from '../../../src/auth/session';
import { DashboardOverview } from '../../../src/components/dashboard/dashboard-overview';
import { DashboardCharts } from '../../../src/components/dashboard/dashboard-charts';
import { createTranslator } from '../../../src/i18n/translator';

export const dynamic = 'force-dynamic';

type DashboardPageProps = {
  searchParams: Promise<{ period?: string | string[] }>;
};

const periods: DashboardPeriod[] = ['7d', '30d', '90d'];

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const session = await getServerSession();
  const t = createTranslator(session?.locale ?? 'uk');
  const selectedPeriod = periodParam((await searchParams).period);
  const dashboard = await getDashboard(selectedPeriod);
  const updatedAt = new Intl.DateTimeFormat(session?.locale === 'en' ? 'en-GB' : 'uk-UA', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: 'short',
    timeZone: dashboard.period.timezone,
  }).format(new Date(dashboard.generatedAt));

  return (
    <main className="dashboard-page">
      <header className="dashboard-live-header">
        <div>
          <h1>{t('dashboard.title')}</h1>
          <p>{t('dashboard.description')}</p>
          <span className="dashboard-updated"><span aria-hidden="true" />{t('dashboard.updated', { date: updatedAt })}</span>
        </div>
        <nav className="dashboard-period-picker" aria-label={t('dashboard.periodLabel')}>
          {periods.map((period) => (
            <Link
              aria-current={period === selectedPeriod ? 'page' : undefined}
              href={`/dashboard?period=${period}`}
              key={period}
            >
              {t(`dashboard.periods.${period}`)}
            </Link>
          ))}
        </nav>
      </header>
      <section className="dashboard-live-content" aria-label={t('dashboard.summaryLabel')} data-period={dashboard.period.key}>
        <DashboardOverview locale={session?.locale ?? 'uk'} metrics={dashboard.metrics} t={t} />
        <DashboardCharts dailyOrders={dashboard.dailyOrders} funnel={dashboard.funnel} locale={session?.locale ?? 'uk'} t={t} />
      </section>
    </main>
  );
}

function periodParam(value: string | string[] | undefined): DashboardPeriod {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate === '7d' || candidate === '90d' ? candidate : '30d';
}
