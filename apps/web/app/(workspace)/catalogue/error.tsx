'use client';

import { useI18n } from '../../../src/i18n/i18n-provider';

export default function CatalogueError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  return <main className="route-state">
    <h1>{t('catalogue.loadError')}</h1>
    <p>{t('catalogue.connectionRetry')}</p>
    <button onClick={reset} type="button">{t('catalogue.retry')}</button>
  </main>;
}
