'use client';

import { useState } from 'react';

import {
  InstagramSettingsForm,
  type InstagramConnectionSummary,
} from './instagram-settings-form';
import { FacebookSettingsForm } from './facebook-settings-form';
import type { FacebookConnectionSummary, FacebookPageCandidate } from '../../../../packages/contracts/src/facebook';
import { useI18n } from '../i18n/i18n-provider';

type SocialChannelId = 'instagram' | 'facebook';

export function SocialChannelHub({ instagram, facebook, facebookSelection = null, membershipRole }: {
  instagram: InstagramConnectionSummary;
  facebook: FacebookConnectionSummary;
  facebookSelection?: { attemptId: string; pages: FacebookPageCandidate[] } | null;
  membershipRole: 'OWNER' | 'MANAGER' | null;
}) {
  const { t } = useI18n();
  const [connection, setConnection] = useState(instagram);
  const [facebookConnection, setFacebookConnection] = useState(facebook);
  const [open, setOpen] = useState<SocialChannelId | null>(null);
  const expanded = open === 'instagram';
  const facebookExpanded = open === 'facebook';
  const status = ({ NOT_CONNECTED: t('settings.notConnected'), LEGACY: t('settings.reconnectRequired'), ACTIVE: t('settings.active'), REAUTH_REQUIRED: t('settings.reconnectRequired'), ERROR: t('settings.connectionError'), DISCONNECTED: t('settings.disabled') })[connection.status];
  const buttonId = 'social-channel-instagram';
  const panelId = `${buttonId}-panel`;

  return <div className="delivery-carrier-hub social-channel-hub" aria-label={t('settings.salesChannels')}>
    <div className="delivery-hub-summary">
      <span>{t('settings.connected')}</span>
      <strong>{t('settings.connectedCount', { connected: Number(connection.status === 'ACTIVE') + Number(facebookConnection.status === 'ACTIVE'), total: 2 })}</strong>
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
      <section className={`delivery-carrier ${facebookExpanded ? 'is-open' : ''}`}>
        <button id="social-channel-facebook" className="delivery-carrier-trigger" type="button" aria-expanded={facebookExpanded} aria-controls="social-channel-facebook-panel" onClick={() => setOpen(facebookExpanded ? null : 'facebook')}>
          <span className="delivery-carrier-mark channel-facebook" aria-hidden="true">FB</span>
          <span className="delivery-carrier-copy"><strong>Facebook</strong><small>{t('facebookSettings.description')}</small></span>
          <span className={`connection-status status-${facebookConnection.status.toLowerCase()}`}>{facebookStatus(facebookConnection.status, t)}</span>
          <svg className="delivery-carrier-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
        </button>
        {facebookExpanded && <div id="social-channel-facebook-panel" className="delivery-carrier-panel" role="region" aria-labelledby="social-channel-facebook">
          <FacebookSettingsForm embedded initial={facebookConnection} membershipRole={membershipRole} selection={facebookSelection} onConnectionChange={setFacebookConnection} />
        </div>}
      </section>
    </div>
  </div>;
}

function facebookStatus(status: FacebookConnectionSummary['status'], t: ReturnType<typeof useI18n>['t']): string {
  return ({
    NOT_CONNECTED: t('facebookSettings.statusNotConnected'),
    ACTIVE: t('facebookSettings.statusActive'),
    REAUTH_REQUIRED: t('facebookSettings.statusReauth'),
    ERROR: t('facebookSettings.statusError'),
    DISCONNECTED: t('facebookSettings.statusDisconnected'),
  })[status];
}
