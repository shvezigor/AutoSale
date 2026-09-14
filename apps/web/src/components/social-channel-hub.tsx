'use client';

import { useState } from 'react';

import {
  InstagramSettingsForm,
  instagramConnectionStatusLabel,
  type InstagramConnectionSummary,
} from './instagram-settings-form';

type SocialChannelId = 'instagram';

export function SocialChannelHub({ instagram, membershipRole }: {
  instagram: InstagramConnectionSummary;
  membershipRole: 'OWNER' | 'MANAGER' | null;
}) {
  const [connection, setConnection] = useState(instagram);
  const [open, setOpen] = useState<SocialChannelId | null>(null);
  const expanded = open === 'instagram';
  const status = instagramConnectionStatusLabel(connection.status);
  const buttonId = 'social-channel-instagram';
  const panelId = `${buttonId}-panel`;

  return <div className="delivery-carrier-hub social-channel-hub" aria-label="Канали продажів">
    <div className="delivery-hub-summary">
      <span>Підключено</span>
      <strong>{connection.status === 'ACTIVE' ? 1 : 0} із 1</strong>
      <p>Відкрийте канал, щоб переглянути акаунт або змінити підключення.</p>
    </div>
    <div className="delivery-carrier-list">
      <section className={`delivery-carrier ${expanded ? 'is-open' : ''}`}>
        <button id={buttonId} className="delivery-carrier-trigger" type="button" aria-expanded={expanded} aria-controls={panelId} onClick={() => setOpen(expanded ? null : 'instagram')}>
          <span className="delivery-carrier-mark channel-instagram" aria-hidden="true">IG</span>
          <span className="delivery-carrier-copy"><strong>Instagram</strong><small>Повідомлення, діалоги та автоматичне створення замовлень</small></span>
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
