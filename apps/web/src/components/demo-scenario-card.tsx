'use client';

import Link from 'next/link';
import { useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';
import { useI18n } from '../i18n/i18n-provider';

export function DemoScenarioCard() {
  const { t } = useI18n();
  const [state, setState] = useState<'idle' | 'running' | 'created' | 'duplicate' | 'error'>('idle');

  async function start() {
    setState('running');
    const response = await mutatingFetch('/api/demo/order-scenario', { method: 'POST' });
    if (!response.ok) return setState('error');
    const result = await response.json() as { duplicate: boolean };
    setState(result.duplicate ? 'duplicate' : 'created');
  }

  const completed = state === 'created' || state === 'duplicate';
  return (
    <section className="settings-card demo-scenario-card" aria-labelledby="demo-scenario-title">
      <div className="settings-card-heading">
        <div>
          <h2 id="demo-scenario-title">{t('settings.demoTitle')}</h2>
          <p>{t('settings.demoDescription')}</p>
        </div>
        <span className="connection-status">DEMO</span>
      </div>
      <div className="demo-scenario-copy">
        <p>{t('settings.demoDetails')}</p>
      </div>
      <div className="settings-actions">
        <button disabled={state === 'running' || completed} onClick={() => void start()} type="button">
          {state === 'running' ? t('settings.demoProcessing') : t('settings.demoStart')}
        </button>
        {state === 'created' && <span className="save-success">{t('settings.demoCreated')}</span>}
        {state === 'duplicate' && <span className="save-success">{t('settings.demoDuplicate')}</span>}
        {state === 'error' && <span className="save-error">{t('settings.demoFailed')}</span>}
      </div>
      {completed && <nav className="demo-scenario-links" aria-label={t('settings.demoResults')}><Link href="/conversations">{t('settings.openConversations')}</Link><Link href="/orders">{t('settings.openOrders')}</Link></nav>}
    </section>
  );
}
