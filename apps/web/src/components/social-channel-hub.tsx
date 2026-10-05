'use client';

import { useState } from 'react';

import {
  InstagramSettingsForm,
  type InstagramConnectionSummary,
} from './instagram-settings-form';
import { FacebookSettingsForm } from './facebook-settings-form';
import type { FacebookConnectionSummary, FacebookPageCandidate } from '../../../../packages/contracts/src/facebook';
import type { TikTokConnectionSummary } from '../../../../packages/contracts/src/tiktok';
import { TikTokSettingsForm, tikTokStatus } from './tiktok-settings-form';
import { useI18n } from '../i18n/i18n-provider';

type SocialChannelId = 'instagram' | 'facebook' | 'tiktok';

export function SocialChannelHub({ instagram, facebook, tiktok, facebookSelection = null, membershipRole }: {
  instagram: InstagramConnectionSummary;
  facebook: FacebookConnectionSummary;
  tiktok: TikTokConnectionSummary;
  facebookSelection?: { attemptId: string; pages: FacebookPageCandidate[] } | null;
  membershipRole: 'OWNER' | 'MANAGER' | null;
}) {
  const { t } = useI18n();
  const [connection, setConnection] = useState(instagram);
  const [facebookConnection, setFacebookConnection] = useState(facebook);
  const [tikTokConnection, setTikTokConnection] = useState(tiktok);
  const [open, setOpen] = useState<SocialChannelId | null>(null);
  const expanded = open === 'instagram';
  const facebookExpanded = open === 'facebook';
  const tikTokExpanded = open === 'tiktok';
  const facebookVisible = facebookConnection.platformAvailability === 'AVAILABLE';
  const tikTokVisible = tikTokConnection.platformAvailability === 'AVAILABLE';
  const visibleChannelCount = 1 + Number(facebookVisible) + Number(tikTokVisible);
  const connectedChannelCount = Number(connection.status === 'ACTIVE')
    + Number(facebookVisible && facebookConnection.status === 'ACTIVE')
    + Number(tikTokVisible && (tikTokConnection.status === 'ACTIVE' || tikTokConnection.status === 'INBOUND_ONLY'));
  const status = ({ NOT_CONNECTED: t('settings.notConnected'), LEGACY: t('settings.reconnectRequired'), ACTIVE: t('settings.active'), REAUTH_REQUIRED: t('settings.reconnectRequired'), ERROR: t('settings.connectionError'), DISCONNECTED: t('settings.disabled') })[connection.status];
  const buttonId = 'social-channel-instagram';
  const panelId = `${buttonId}-panel`;

  return <div className="delivery-carrier-hub social-channel-hub" aria-label={t('settings.salesChannels')}>
    <div className="delivery-hub-summary">
      <span>{t('settings.connected')}</span>
      <strong>{t('settings.connectedCount', { connected: connectedChannelCount, total: visibleChannelCount })}</strong>
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
      {facebookVisible && <section className={`delivery-carrier ${facebookExpanded ? 'is-open' : ''}`}>
        <button id="social-channel-facebook" className="delivery-carrier-trigger" type="button" aria-expanded={facebookExpanded} aria-controls="social-channel-facebook-panel" onClick={() => setOpen(facebookExpanded ? null : 'facebook')}>
          <span className="delivery-carrier-mark channel-facebook" aria-hidden="true">FB</span>
          <span className="delivery-carrier-copy"><strong>Facebook</strong><small>{t('facebookSettings.description')}</small></span>
          <span className={`connection-status status-${facebookConnection.status.toLowerCase()}`}>{facebookStatus(facebookConnection.status, t)}</span>
          <svg className="delivery-carrier-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
        </button>
        {facebookExpanded && <div id="social-channel-facebook-panel" className="delivery-carrier-panel" role="region" aria-labelledby="social-channel-facebook">
          <FacebookSettingsForm embedded initial={facebookConnection} membershipRole={membershipRole} selection={facebookSelection} onConnectionChange={setFacebookConnection} />
        </div>}
      </section>}
      {tikTokVisible && <section className={`delivery-carrier ${tikTokExpanded ? 'is-open' : ''}`}>
        <button id="social-channel-tiktok" className="delivery-carrier-trigger" type="button" aria-expanded={tikTokExpanded} aria-controls="social-channel-tiktok-panel" onClick={() => setOpen(tikTokExpanded ? null : 'tiktok')}>
          <span className="delivery-carrier-mark channel-tiktok" aria-hidden="true">TT</span>
          <span className="delivery-carrier-copy"><strong>TikTok</strong><small>{t('tiktokSettings.description')}</small></span>
          <span className={`connection-status status-${tikTokConnection.status.toLowerCase()}`}>{tikTokStatus(tikTokConnection.status, t)}</span>
          <svg className="delivery-carrier-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
        </button>
        {tikTokExpanded && <div id="social-channel-tiktok-panel" className="delivery-carrier-panel" role="region" aria-labelledby="social-channel-tiktok">
          <TikTokSettingsForm embedded initial={tikTokConnection} membershipRole={membershipRole} onConnectionChange={setTikTokConnection} />
        </div>}
      </section>}
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
