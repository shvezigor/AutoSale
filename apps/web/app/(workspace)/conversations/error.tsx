'use client';
import { useI18n } from '../../../src/i18n/i18n-provider';

export default function ConversationsError({ reset }: { reset: () => void }) {
  const { t } = useI18n();
  return <div className="conversation-detail-transition"><main className="route-state"><h1>{t('conversations.loadError')}</h1><p>{t('conversations.connectionRetry')}</p><button onClick={reset} type="button">{t('conversations.retry')}</button></main></div>;
}
