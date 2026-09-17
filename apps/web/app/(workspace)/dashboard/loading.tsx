'use client';

import { useI18n } from '../../../src/i18n/i18n-provider';

export default function DashboardLoading() {
  const { t } = useI18n();
  return (
    <main aria-busy="true" aria-live="polite" className="dashboard-page dashboard-loading" role="status">
      <span className="sr-only">{t('common.loading')}</span>
      <header className="dashboard-loading-header" aria-hidden="true"><i /><i /></header>
      <section className="dashboard-loading-metrics" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => <div data-dashboard-skeleton="metric" key={index}><i /><i /><i /></div>)}
      </section>
      <section className="dashboard-loading-panels" aria-hidden="true"><div /><div /></section>
    </main>
  );
}
