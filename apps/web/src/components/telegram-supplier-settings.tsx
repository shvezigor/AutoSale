'use client';

import type { TelegramSupplierSettings as SupplierSettings } from '../../../../packages/contracts/src/telegram';
import { useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';
import { useActivity } from './activity-provider';
import { LoadingButton } from './loading-button';
import { useToast } from './toast-provider';
import { useI18n } from '../i18n/i18n-provider';

export function TelegramSupplierSettings({
  initial,
  navigate = (url) => { window.location.href = url; },
}: {
  initial: SupplierSettings;
  navigate?: (url: string) => void;
}) {
  const [settings, setSettings] = useState(initial);
  const [destinationId, setDestinationId] = useState(initial.selectedDestinationId ?? '');
  const [pendingAction, setPendingAction] = useState<'save' | 'group' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const activity = useActivity();
  const toast = useToast();
  const { t } = useI18n();
  const pending = pendingAction !== null;

  async function save() {
    if (!destinationId) return;
    setPendingAction('save'); setMessage(null);
    try {
      const response = await activity.run(t('telegram.savingSupplier'), () => mutatingFetch('/api/integrations/telegram/supplier', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ destinationId, autoDispatch: false }),
      }));
      if (!response.ok) throw new Error('save failed');
      const next = await response.json() as SupplierSettings;
      setSettings(next); setDestinationId(next.selectedDestinationId ?? ''); setMessage(t('telegram.supplierSaved'));
      toast.show({ type: 'success', title: t('telegram.supplierSaved'), message: t('telegram.supplierSavedHint') });
    } catch {
      toast.show({ type: 'error', title: t('telegram.supplierSaveFailed') });
    } finally { setPendingAction(null); }
  }

  async function addGroup() {
    setPendingAction('group'); setMessage(null);
    try {
      const response = await activity.run(t('telegram.openingTelegram'), () => mutatingFetch('/api/integrations/telegram/link', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ purpose: 'SUPPLIER_GROUP', returnPath: '/settings?tab=suppliers' }),
      }));
      const payload = await response.json() as { url?: string };
      if (!response.ok || !payload.url) throw new Error('group link failed');
      navigate(payload.url);
    } catch {
      toast.show({ type: 'error', title: t('telegram.telegramOpenFailed') });
    } finally { setPendingAction(null); }
  }

  const selectedChanged = destinationId !== (settings.selectedDestinationId ?? '');
  return <section aria-label={t('telegram.supplierRegion')} className="settings-card telegram-supplier-card">
    <div className="settings-card-heading"><div><h2>{t('telegram.supplierTitle')}</h2><p>{t('telegram.supplierDescription')}</p></div><span className={`connection-status ${settings.selectedDestinationId ? 'status-active' : 'status-not_connected'}`}>{settings.selectedDestinationId ? t('telegram.configured') : t('telegram.notConfigured')}</span></div>
    <div className="telegram-connection-copy"><strong>Telegram Business</strong><p>{t('telegram.businessInstructions')}</p></div>
    {settings.destinations.length > 0 && <label className="telegram-supplier-select"><span>{t('telegram.supplierChat')}</span><select aria-label={t('telegram.supplierChat')} disabled={pending} onChange={(event) => { setDestinationId(event.target.value); setMessage(null); }} value={destinationId}><option value="">{t('telegram.selectChat')}</option>{settings.destinations.map((destination) => <option key={destination.id} value={destination.id}>{destination.title} · {destination.route === 'BUSINESS' ? t('telegram.yourAccount') : t('telegram.botGroup')}</option>)}</select></label>}
    {settings.destinations.length === 0 && <p className="telegram-supplier-empty">{t('telegram.noSupplierChats')}</p>}
    <div className="settings-actions telegram-connection-actions">
      <LoadingButton pending={pendingAction === 'group'} pendingLabel={t('telegram.opening')} disabled={pending} className="secondary-button" onClick={() => void addGroup()} type="button">{t('telegram.addReserveGroup')}</LoadingButton>
      {settings.destinations.length > 0 && <LoadingButton pending={pendingAction === 'save'} pendingLabel={t('telegram.saving')} disabled={pending || !destinationId || !selectedChanged} onClick={() => void save()} type="button">{t('telegram.saveSupplier')}</LoadingButton>}
    </div>
    {message && <span className="save-success" role="status">{message}</span>}
  </section>;
}
