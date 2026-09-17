'use client';

import type { DeliveryLocation, MeestConnectionSummary, MeestSenderProfileInput } from '../../../../packages/contracts/src/delivery';
import { useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';
import { useI18n } from '../i18n/i18n-provider';
import type { Translator } from '../i18n/translator';
import { useActivity } from './activity-provider';
import { useConfirm } from './confirm-provider';
import { DeliveryLocationPicker } from './delivery-location-picker';
import { LoadingButton } from './loading-button';
import { useToast } from './toast-provider';

export type MeestSettingsSummary = {
  enabled: boolean;
  connection: MeestConnectionSummary | null;
};

const emptyProfileBase: Omit<MeestSenderProfileInput, 'customerNotificationTemplate'> = {
  senderName: '', senderPhone: '',
  origin: { type: 'BRANCH', cityRef: '', locationRef: '', label: '' },
  payer: 'SENDER', defaultParcel: { weightKg: 1, lengthCm: 30, widthCm: 20, heightCm: 10 },
  suggestCustomerNotification: true,
};

export function MeestSettingsCard({ initial, role, embedded = false, onConnectionChange }: { initial: MeestSettingsSummary; role: 'OWNER' | 'MANAGER'; embedded?: boolean; onConnectionChange?(connection: MeestConnectionSummary | null): void }) {
  const { t } = useI18n();
  const emptyProfile: MeestSenderProfileInput = { ...emptyProfileBase, customerNotificationTemplate: t('meestSettings.defaultTemplate') };
  const [connection, setConnection] = useState(initial.connection);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [clientUid, setClientUid] = useState('');
  const [profile, setProfile] = useState<MeestSenderProfileInput>(initial.connection?.senderProfile ?? emptyProfile);
  const [city, setCity] = useState<DeliveryLocation | null>(null);
  const [pending, setPending] = useState<'connect' | 'disconnect' | 'profile' | null>(null);
  const activity = useActivity();
  const confirm = useConfirm();
  const toast = useToast();
  const owner = role === 'OWNER';
  const active = connection?.status === 'ACTIVE';

  async function connect(): Promise<void> {
    setPending('connect');
    try {
      const response = await activity.run(t('meestSettings.connectingActivity'), () => mutatingFetch('/api/integrations/delivery/meest', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ login: login.trim(), password, clientUid: clientUid.trim() }),
      }));
      const payload = await jsonOrNull(response);
      if (!response.ok || !isMeestConnection(payload)) throw new Error('connection failed');
      setConnection(payload);
      onConnectionChange?.(payload);
      setProfile(payload.senderProfile ?? emptyProfile);
      setLogin('');
      setPassword('');
      setClientUid('');
      toast.show({ type: 'success', title: t('meestSettings.connected') });
    } catch {
      setPassword('');
      toast.show({ type: 'error', title: t('meestSettings.connectFailed'), message: t('meestSettings.connectFailedHint') });
    } finally {
      setPending(null);
    }
  }

  async function saveProfile(): Promise<void> {
    setPending('profile');
    try {
      const response = await activity.run(t('meestSettings.savingSender'), () => mutatingFetch('/api/integrations/delivery/meest/sender-profile', {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(profile),
      }));
      const payload = await jsonOrNull(response);
      if (!response.ok || !isMeestSenderProfile(payload)) throw new Error('profile failed');
      setProfile(payload);
      const next = connection ? { ...connection, senderProfile: payload } : null;
      setConnection(next);
      onConnectionChange?.(next);
      toast.show({ type: 'success', title: t('meestSettings.senderSaved') });
    } catch {
      toast.show({ type: 'error', title: t('meestSettings.senderSaveFailed') });
    } finally {
      setPending(null);
    }
  }

  async function disconnect(): Promise<void> {
    const approved = await confirm({
      title: t('meestSettings.disconnectTitle'), description: t('meestSettings.disconnectDescription'), confirmLabel: t('meestSettings.confirmDisconnect'),
      tone: 'danger',
    });
    if (!approved) return;
    setPending('disconnect');
    try {
      const response = await activity.run(t('meestSettings.disconnectingActivity'), () => mutatingFetch('/api/integrations/delivery/meest', { method: 'DELETE' }));
      if (!response.ok) throw new Error('disconnect failed');
      setConnection(null);
      onConnectionChange?.(null);
      toast.show({ type: 'success', title: t('meestSettings.disconnected') });
    } catch {
      toast.show({ type: 'error', title: t('meestSettings.disconnectFailed') });
    } finally {
      setPending(null);
    }
  }

  if (!initial.enabled) return null;

  return <section className={`settings-card delivery-settings-card ${embedded ? 'is-embedded' : ''}`} {...(embedded ? { 'aria-label': 'Meest' } : { 'aria-labelledby': 'meest-settings-title' })} aria-busy={pending !== null || undefined}>
    {!embedded && <div className="settings-card-heading">
      <div><h2 id="meest-settings-title">Meest</h2><p>{t('meestSettings.description')}</p></div>
      <span className={`connection-status status-${(connection?.status ?? 'NOT_CONNECTED').toLowerCase()}`}>{statusLabel(t, connection?.status)}</span>
    </div>}
    {embedded && <div className="delivery-panel-section-heading"><span>{t('novaPoshtaSettings.connection')}</span><p>{t('novaPoshtaSettings.connectionDescription')}</p></div>}
    {connection?.accountLabel && <div className="delivery-account-summary"><span>{t('meestSettings.account')}</span><strong>{connection.accountLabel}</strong></div>}
    {!owner
      ? <p className="delivery-readonly-note">{t('meestSettings.ownerOnly')}</p>
      : <>
          <div className="delivery-connect-guide">
            <div><strong>{active ? t('meestSettings.replaceAccessQuestion') : t('meestSettings.agreementRequired')}</strong><span>{t('meestSettings.accessHint')}</span></div>
            <a className="secondary-button" href="https://wiki.meest-group.com/uk/api/api-eng" target="_blank" rel="noreferrer">{t('meestSettings.docs')}</a>
          </div>
          <div className="meest-connect-grid">
            <label className="settings-field"><span>{t('meestSettings.login')}</span><input aria-label={t('meestSettings.login')} autoComplete="off" value={login} onChange={(event) => setLogin(event.target.value)} /></label>
            <label className="settings-field"><span>{t('meestSettings.password')}</span><input aria-label={t('meestSettings.password')} autoComplete="new-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <label className="settings-field"><span>ClientUID</span><input aria-label="ClientUID" autoComplete="off" value={clientUid} onChange={(event) => setClientUid(event.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" /></label>
          </div>
          <p className="delivery-key-note">{t('meestSettings.security')}</p>
          <div className="settings-actions delivery-settings-actions">
            <LoadingButton type="button" pending={pending === 'connect'} pendingLabel={t('meestSettings.connecting')} disabled={pending !== null || !login.trim() || !password || !isUuid(clientUid.trim())} onClick={() => void connect()}>{active ? t('meestSettings.replaceAccess') : t('meestSettings.connect')}</LoadingButton>
            {active && <LoadingButton type="button" className="danger-button" pending={pending === 'disconnect'} pendingLabel={t('meestSettings.disconnecting')} disabled={pending !== null} onClick={() => void disconnect()}>{t('meestSettings.disconnect')}</LoadingButton>}
          </div>
          {active && <fieldset className="delivery-sender-form" disabled={pending !== null}>
            <legend>{t('meestSettings.senderLegend')}</legend>
            <div className="meest-connect-grid">
              <label><span>{t('meestSettings.senderName')}</span><input aria-label={t('meestSettings.senderName')} value={profile.senderName} onChange={(event) => setProfile((current) => ({ ...current, senderName: event.target.value }))} /></label>
              <label><span>{t('meestSettings.senderPhone')}</span><input aria-label={t('meestSettings.senderPhone')} inputMode="tel" placeholder="+380501112233" value={profile.senderPhone} onChange={(event) => setProfile((current) => ({ ...current, senderPhone: event.target.value }))} /></label>
            </div>
            <div className="delivery-origin-grid">
              <DeliveryLocationPicker provider="MEEST" label={t('meestSettings.city')} type="CITY" value={city} onSelect={(value) => setCity(value)} />
              <DeliveryLocationPicker
                provider="MEEST"
                label={t('meestSettings.branch')}
                type="BRANCH"
                {...(city?.ref || profile.origin.cityRef ? { cityRef: city?.ref ?? profile.origin.cityRef } : {})}
                value={profile.origin.locationRef ? { ref: profile.origin.locationRef, provider: 'MEEST', type: profile.origin.type, label: profile.origin.label, cityRef: profile.origin.cityRef } : null}
                onSelect={(value) => setProfile((current) => ({
                  ...current,
                  origin: value ? { type: value.type === 'PARCEL_LOCKER' ? 'PARCEL_LOCKER' : 'BRANCH', cityRef: value.cityRef!, locationRef: value.ref, label: value.label } : { type: 'BRANCH', cityRef: city?.ref ?? '', locationRef: '', label: '' },
                }))}
              />
            </div>
            <div className="delivery-parcel-grid">
              <NumberField label={t('novaPoshtaSettings.weight')} value={profile.defaultParcel.weightKg} onChange={(value) => setProfile((current) => ({ ...current, defaultParcel: { ...current.defaultParcel, weightKg: value } }))} />
              <NumberField label={t('novaPoshtaSettings.length')} value={profile.defaultParcel.lengthCm} onChange={(value) => setProfile((current) => ({ ...current, defaultParcel: { ...current.defaultParcel, lengthCm: value } }))} />
              <NumberField label={t('novaPoshtaSettings.width')} value={profile.defaultParcel.widthCm} onChange={(value) => setProfile((current) => ({ ...current, defaultParcel: { ...current.defaultParcel, widthCm: value } }))} />
              <NumberField label={t('novaPoshtaSettings.height')} value={profile.defaultParcel.heightCm} onChange={(value) => setProfile((current) => ({ ...current, defaultParcel: { ...current.defaultParcel, heightCm: value } }))} />
            </div>
            <label><span>{t('meestSettings.payer')}</span><select value={profile.payer} onChange={(event) => setProfile((current) => ({ ...current, payer: event.target.value as MeestSenderProfileInput['payer'] }))}><option value="SENDER">{t('meestSettings.sender')}</option><option value="RECIPIENT">{t('meestSettings.recipient')}</option></select></label>
            <label className="delivery-checkbox"><input type="checkbox" checked={profile.suggestCustomerNotification} onChange={(event) => setProfile((current) => ({ ...current, suggestCustomerNotification: event.target.checked }))} /><span>{t('meestSettings.suggestNotification')}</span></label>
            <label><span>{t('meestSettings.template')}</span><textarea value={profile.customerNotificationTemplate} onChange={(event) => setProfile((current) => ({ ...current, customerNotificationTemplate: event.target.value }))} /></label>
            <div className="settings-actions delivery-settings-actions"><LoadingButton type="button" pending={pending === 'profile'} pendingLabel={t('meestSettings.saving')} disabled={pending !== null || !validProfile(profile)} onClick={() => void saveProfile()}>{t('meestSettings.saveSender')}</LoadingButton></div>
          </fieldset>}
        </>}
  </section>;
}

function statusLabel(t: Translator, status: MeestConnectionSummary['status'] | undefined): string {
  if (!status) return t('meestSettings.statusNotConnected');
  return ({ ACTIVE: t('meestSettings.statusActive'), NEEDS_ATTENTION: t('meestSettings.statusNeedsAttention'), DISCONNECTED: t('meestSettings.statusDisconnected') } as const)[status];
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function jsonOrNull(response: Response): Promise<unknown> {
  try { return await response.json(); }
  catch { return null; }
}

function isMeestConnection(value: unknown): value is MeestConnectionSummary {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.provider === 'MEEST'
    && (record.status === 'ACTIVE' || record.status === 'NEEDS_ATTENTION' || record.status === 'DISCONNECTED')
    && (typeof record.accountLabel === 'string' || record.accountLabel === null)
    && (typeof record.lastVerifiedAt === 'string' || record.lastVerifiedAt === null)
    && (typeof record.lastErrorCode === 'string' || record.lastErrorCode === null)
    && (record.senderProfile === null || isMeestSenderProfile(record.senderProfile));
}

function isMeestSenderProfile(value: unknown): value is MeestSenderProfileInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const profile = value as Record<string, unknown>;
  return typeof profile.senderName === 'string' && typeof profile.senderPhone === 'string'
    && typeof profile.origin === 'object' && profile.origin !== null
    && typeof profile.defaultParcel === 'object' && profile.defaultParcel !== null
    && (profile.payer === 'SENDER' || profile.payer === 'RECIPIENT')
    && typeof profile.suggestCustomerNotification === 'boolean'
    && typeof profile.customerNotificationTemplate === 'string';
}

function validProfile(profile: MeestSenderProfileInput): boolean {
  return profile.senderName.trim().length >= 2
    && /^\+380\d{9}$/.test(profile.senderPhone)
    && Boolean(profile.origin.cityRef && profile.origin.locationRef && profile.origin.label)
    && Object.values(profile.defaultParcel).every((value) => Number.isFinite(value) && value > 0)
    && Boolean(profile.customerNotificationTemplate.trim());
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange(value: number): void }) {
  return <label><span>{label}</span><input aria-label={label} type="number" min="0.01" step="0.01" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}
