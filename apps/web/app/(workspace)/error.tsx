'use client';

import { useI18n } from '../../src/i18n/i18n-provider';

export default function WorkspaceError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  return <main className="route-state" role="alert">
    <h1>{t('errors.sectionLoadFailed')}</h1>
    <p>{t('errors.retryRequest')}</p>
    <button className="primary-button" type="button" onClick={reset}>{t('errors.retry')}</button>
  </main>;
}
