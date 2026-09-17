'use client';

import { useI18n } from '../../../src/i18n/i18n-provider';

export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  return (
    <main className="dashboard-page dashboard-error-state" role="alert">
      <section>
        <span aria-hidden="true">!</span>
        <h1>{t('dashboard.error.title')}</h1>
        <p>{t('dashboard.error.description')}</p>
        <button className="primary-button" onClick={reset} type="button">{t('dashboard.error.retry')}</button>
      </section>
    </main>
  );
}
