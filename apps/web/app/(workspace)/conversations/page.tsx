'use client';

import { useI18n } from '../../../src/i18n/i18n-provider';

export default function ConversationsPage() {
  const { t } = useI18n();
  return (
    <div className="conversation-detail-transition">
      <section className="conversation-empty">
        <div className="empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 17 17 7M10 7h7v7" /></svg></div>
        <h2>{t('conversations.selectTitle')}</h2>
        <p>{t('conversations.selectDescription')}</p>
      </section>
      <aside className="order-panel">
        <h2>{t('conversations.orderInformation')}</h2>
        <div className="order-empty">
          <div className="bag-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 8h12l-1 12H7L6 8Z" /><path d="M9 9V6a3 3 0 0 1 6 0v3" /></svg></div>
          <strong>{t('conversations.noOrder')}</strong>
          <p>{t('conversations.selectForCustomer')}</p>
        </div>
      </aside>
    </div>
  );
}
