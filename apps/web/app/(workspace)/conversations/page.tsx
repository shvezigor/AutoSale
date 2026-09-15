'use client';

import { useI18n } from '../../../src/i18n/i18n-provider';

export default function ConversationsPage() {
  const { t } = useI18n();
  return (
    <div className="conversation-detail-transition">
      <section className="conversation-empty">
        <div className="empty-icon" aria-hidden="true">↗</div>
        <h2>{t('conversations.selectTitle')}</h2>
        <p>{t('conversations.selectDescription')}</p>
      </section>
      <aside className="order-panel">
        <h2>{t('conversations.orderInformation')}</h2>
        <div className="order-empty">
          <div className="bag-icon" aria-hidden="true">□</div>
          <strong>{t('conversations.noOrder')}</strong>
          <p>{t('conversations.selectForCustomer')}</p>
        </div>
      </aside>
    </div>
  );
}
