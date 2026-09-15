'use client';

import { useState } from 'react';

import { TelegramSettingsCard, type TelegramConnectionSummary } from './telegram-settings-card';
import type { TelegramNotificationPreferences } from '../../../../packages/contracts/src/telegram';
import { useI18n } from '../i18n/i18n-provider';

export function NotificationChannelHub({ telegram, telegramPreferences }: {
  telegram: TelegramConnectionSummary;
  telegramPreferences: TelegramNotificationPreferences;
}) {
  const { t } = useI18n();
  const [connection, setConnection] = useState(telegram);
  const [open, setOpen] = useState(false);
  const connected = connection.personal.connected;
  const status = !connection.available ? t('settings.unavailable') : connected ? t('settings.connected') : t('settings.notConnected');
  const buttonId = 'notification-channel-telegram';
  const panelId = `${buttonId}-panel`;

  return <div className="delivery-carrier-hub notification-channel-hub" aria-label={t('settings.notificationChannels')}>
    <div className="delivery-hub-summary">
      <span>{t('settings.connected')}</span>
      <strong>{t('settings.connectedCount', { connected: connected ? 1 : 0, total: 1 })}</strong>
      <p>{t('settings.openNotificationChannel')}</p>
    </div>
    <div className="delivery-carrier-list">
      <section className={`delivery-carrier ${open ? 'is-open' : ''}`}>
        <button id={buttonId} className="delivery-carrier-trigger" type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}>
          <span className="delivery-carrier-mark channel-telegram" aria-hidden="true">TG</span>
          <span className="delivery-carrier-copy"><strong>Telegram</strong><small>{t('settings.telegramDescription')}</small></span>
          <span className={`connection-status ${connected ? 'status-active' : 'status-not_connected'}`}>{status}</span>
          <svg className="delivery-carrier-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
        </button>
        {open && <div id={panelId} className="delivery-carrier-panel" role="region" aria-labelledby={buttonId}>
          <TelegramSettingsCard embedded initial={connection} initialPreferences={telegramPreferences} onConnectionChange={setConnection} />
        </div>}
      </section>
    </div>
  </div>;
}
