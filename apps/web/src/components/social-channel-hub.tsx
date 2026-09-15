'use client';

import { useState } from 'react';

import {
  InstagramSettingsForm,
  type InstagramConnectionSummary,
} from './instagram-settings-form';
import { useI18n } from '../i18n/i18n-provider';

type SocialChannelId = 'instagram';

export function SocialChannelHub({ instagram, membershipRole }: {
  instagram: InstagramConnectionSummary;
  membershipRole: 'OWNER' | 'MANAGER' | null;
}) {
  const { t } = useI18n();
  const [connection, setConnection] = useState(instagram);
  const [open, setOpen] = useState<SocialChannelId | null>(null);
  const expanded = open === 'instagram';
  const status = ({ NOT_CONNECTED: t('settings.notConnected'), LEGACY: t('settings.reconnectRequired'), ACTIVE: t('settings.active'), REAUTH_REQUIRED: t('settings.reconnectRequired'), ERROR: t('settings.connectionError'), DISCONNECTED: t('settings.disabled') })[connection.status];
  const buttonId = 'social-channel-instagram';
  const panelId = `${buttonId}-panel`;

  return <div className="delivery-carrier-hub social-channel-hub" aria-label={t('settings.salesChannels')}>
    <div className="delivery-hub-summary">
      <span>{t('settings.connected')}</span>
      <strong>{t('settings.connectedCount', { connected: connection.status === 'ACTIVE' ? 1 : 0, total: 1 })}</strong>
      <p>{t('settings.openChannel')}</p>
    </div>
    <div className="delivery-carrier-list">
      <section className={`delivery-carrier ${expanded ? 'is-open' : ''}`}>
        <button id={buttonId} className="delivery-carrier-trigger" type="button" aria-expanded={expanded} aria-controls={panelId} onClick={() => setOpen(expanded ? null : 'instagram')}>
          <span className="delivery-carrier-mark channel-instagram" aria-hidden="true">IG</span>
          <span className="delivery-carrier-copy"><strong>Instagram</strong><small>{t('settings.instagramDescription')}</small></span>
          <span className={`connection-status status-${connection.status.toLowerCase()}`}>{status}</span>
          <svg className="delivery-carrier-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
        </button>
        {expanded && <div id={panelId} className="delivery-carrier-panel" role="region" aria-labelledby={buttonId}>
          <InstagramSettingsForm embedded initial={connection} membershipRole={membershipRole} onConnectionChange={setConnection} />
        </div>}
      </section>
    </div>
  </div>;
}
