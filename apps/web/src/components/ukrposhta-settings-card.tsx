'use client';

import { isUkrposhtaPersonName, type DeliveryLocation, type UkrposhtaConnectionSummary, type UkrposhtaSenderProfileInput } from '../../../../packages/contracts/src/delivery';
import { useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';
import { useI18n } from '../i18n/i18n-provider';
import type { Translator } from '../i18n/translator';
import { useActivity } from './activity-provider';
import { useConfirm } from './confirm-provider';
import { DeliveryLocationPicker } from './delivery-location-picker';
import { FieldError } from './form-field';
import { clearFieldError, type FieldErrors } from './form-validation';
import { LoadingButton } from './loading-button';
import { useToast } from './toast-provider';

export type UkrposhtaSettingsSummary = {
  enabled: boolean;
  connection: UkrposhtaConnectionSummary | null;
};

const emptyProfileBase: Omit<UkrposhtaSenderProfileInput, 'customerNotificationTemplate'> = {
  senderName: '', senderPhone: '',
  origin: { type: 'BRANCH', cityRef: '', locationRef: '', label: '' },
  payer: 'SENDER', defaultParcel: { weightKg: 1, lengthCm: 30, widthCm: 20, heightCm: 10 },
  suggestCustomerNotification: true,
};

export function UkrposhtaSettingsCard({ initial, role, embedded = false, onConnectionChange }: { initial: UkrposhtaSettingsSummary; role: 'OWNER' | 'MANAGER'; embedded?: boolean; onConnectionChange?(connection: UkrposhtaConnectionSummary | null): void }) {
  const { t, formatNumber } = useI18n();
  const emptyProfile: UkrposhtaSenderProfileInput = { ...emptyProfileBase, customerNotificationTemplate: t('ukrposhtaSettings.defaultTemplate') };
  const [connection, setConnection] = useState(initial.connection);
  const [environment, setEnvironment] = useState<'SANDBOX' | 'PRODUCTION'>(initial.connection?.environment ?? 'SANDBOX');
  const [ecomBearer, setEcomBearer] = useState('');
  const [counterpartyToken, setCounterpartyToken] = useState('');
  const [trackingBearer, setTrackingBearer] = useState('');
  const [counterpartyUuid, setCounterpartyUuid] = useState('');
  type CredentialField = 'ecom' | 'counterpartyToken' | 'tracking' | 'counterpartyUuid';
  const [credentialErrors, setCredentialErrors] = useState<FieldErrors<CredentialField>>({});
  const [profile, setProfile] = useState<UkrposhtaSenderProfileInput>(initial.connection?.senderProfile ?? emptyProfile);
  type SenderField = 'name' | 'phone' | 'origin' | 'weight' | 'length' | 'width' | 'height' | 'template';
  const [senderErrors, setSenderErrors] = useState<FieldErrors<SenderField>>({});
  const [city, setCity] = useState<DeliveryLocation | null>(() => citySelectionFromProfile(initial.connection?.senderProfile));
  const [pending, setPending] = useState<'connect' | 'disconnect' | 'profile' | null>(null);
  const activity = useActivity();
  const confirm = useConfirm();
  const toast = useToast();
  const owner = role === 'OWNER';
  const active = connection?.status === 'ACTIVE';

  function clearSecrets(): void {
    setEcomBearer('');
    setCounterpartyToken('');
    setTrackingBearer('');
    setCounterpartyUuid('');
  }

  async function connect(): Promise<void> {
    const errors: FieldErrors<CredentialField> = {};
    if (ecomBearer.trim().length < 8) errors.ecom = ecomBearer.trim() ? t('validation.invalid') : t('validation.required');
    if (counterpartyToken.trim().length < 8) errors.counterpartyToken = counterpartyToken.trim() ? t('validation.invalid') : t('validation.required');
    if (trackingBearer.trim().length < 8) errors.tracking = trackingBearer.trim() ? t('validation.invalid') : t('validation.required');
    if (!isUuid(counterpartyUuid.trim())) errors.counterpartyUuid = t('validation.invalid');
    setCredentialErrors(errors);
    if (Object.keys(errors).length) {
      const first = (['ecom', 'counterpartyToken', 'tracking', 'counterpartyUuid'] as const).find((field) => errors[field]);
      document.getElementById(`ukrposhta-${first}`)?.focus();
      return;
    }
    setPending('connect');
    try {
      const response = await activity.run(t('ukrposhtaSettings.connectingActivity'), () => mutatingFetch('/api/integrations/delivery/ukrposhta', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ environment, ecomBearer: ecomBearer.trim(), counterpartyToken: counterpartyToken.trim(), trackingBearer: trackingBearer.trim(), counterpartyUuid: counterpartyUuid.trim() }),
      }));
      const payload = await jsonOrNull(response);
      if (!response.ok || !isUkrposhtaConnection(payload)) throw new Error('connection failed');
      setConnection(payload);
      onConnectionChange?.(payload);
      setEnvironment(payload.environment ?? 'SANDBOX');
      setProfile(payload.senderProfile ?? emptyProfile);
      setCity(citySelectionFromProfile(payload.senderProfile));
      toast.show({ type: 'success', title: t('ukrposhtaSettings.connected') });
    } catch {
      toast.show({ type: 'error', title: t('ukrposhtaSettings.connectFailed'), message: t('ukrposhtaSettings.connectFailedHint') });
    } finally {
      clearSecrets();
      setPending(null);
    }
  }

  async function saveProfile(): Promise<void> {
    const errors: FieldErrors<SenderField> = {};
    if (!isUkrposhtaPersonName(profile.senderName) || profile.senderName.trim().length > 120) errors.name = t('validation.invalid');
    if (!/^\+380\d{9}$/.test(profile.senderPhone)) errors.phone = t('validation.invalid');
    if (!profile.origin.cityRef || !/^up:\d{1,20}:\d{5}$/.test(profile.origin.locationRef)) errors.origin = t('ukrposhtaSettings.branchRequired');
    for (const [field, value, max] of [
      ['weight', profile.defaultParcel.weightKg, 1_000], ['length', profile.defaultParcel.lengthCm, 300],
      ['width', profile.defaultParcel.widthCm, 300], ['height', profile.defaultParcel.heightCm, 300],
    ] as const) {
      if (!Number.isFinite(value) || value <= 0) errors[field] = t('validation.minimum', { value: 0.01 });
      else if (value > max) errors[field] = t('validation.maximum', { value: max });
    }
    if (!profile.customerNotificationTemplate.trim()) errors.template = t('validation.required');
    setSenderErrors(errors);
    if (Object.keys(errors).length) {
      const first = (['name', 'phone', 'origin', 'weight', 'length', 'width', 'height', 'template'] as const).find((field) => errors[field]);
      document.getElementById(`ukrposhta-sender-${first}`)?.focus();
      return;
    }
    setPending('profile');
    try {
      const response = await activity.run(t('ukrposhtaSettings.savingSender'), () => mutatingFetch('/api/integrations/delivery/ukrposhta/sender-profile', {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(profile),
      }));
      const payload = await jsonOrNull(response);
      if (!response.ok || !isUkrposhtaSenderProfile(payload)) throw new Error('profile failed');
      setProfile(payload);
      const next = connection ? { ...connection, senderProfile: payload } : null;
      setConnection(next);
      onConnectionChange?.(next);
      toast.show({ type: 'success', title: t('ukrposhtaSettings.senderSaved') });
    } catch {
      toast.show({ type: 'error', title: t('ukrposhtaSettings.senderSaveFailed') });
    } finally {
      setPending(null);
    }
  }

  async function disconnect(): Promise<void> {
    const approved = await confirm({
      title: t('ukrposhtaSettings.disconnectTitle'), description: t('ukrposhtaSettings.disconnectDescription'), confirmLabel: t('ukrposhtaSettings.confirmDisconnect'),
      tone: 'danger',
    });
    if (!approved) return;
    setPending('disconnect');
    try {
      const response = await activity.run(t('ukrposhtaSettings.disconnectingActivity'), () => mutatingFetch('/api/integrations/delivery/ukrposhta', { method: 'DELETE' }));
      if (!response.ok) throw new Error('disconnect failed');
      setConnection(null);
      onConnectionChange?.(null);
      setProfile(emptyProfile);
      setCity(null);
      toast.show({ type: 'success', title: t('ukrposhtaSettings.disconnected') });
    } catch {
      toast.show({ type: 'error', title: t('ukrposhtaSettings.disconnectFailed') });
    } finally {
      setPending(null);
    }
  }

  if (!initial.enabled) return null;

  return <section className={`settings-card delivery-settings-card ${embedded ? 'is-embedded' : ''}`} {...(embedded ? { 'aria-label': t('ukrposhtaSettings.provider') } : { 'aria-labelledby': 'ukrposhta-settings-title' })} aria-busy={pending !== null || undefined}>
    {!embedded && <div className="settings-card-heading">
      <div><h2 id="ukrposhta-settings-title">{t('ukrposhtaSettings.provider')}</h2><p>{t('ukrposhtaSettings.description')}</p></div>
      <span className={`connection-status status-${(connection?.status ?? 'NOT_CONNECTED').toLowerCase()}`}>{statusLabel(t, connection?.status)}</span>
    </div>}
    {embedded && <div className="delivery-panel-section-heading"><span>{t('novaPoshtaSettings.connection')}</span><p>{t('novaPoshtaSettings.connectionDescription')}</p></div>}
    {connection?.accountLabel && <div className="delivery-account-summary"><span>{t('ukrposhtaSettings.account')}</span><strong>{connection.accountLabel}</strong></div>}
    {connection?.environment && <div className="delivery-account-summary"><span>{t('ukrposhtaSettings.environment')}</span><strong>{environmentLabel(t, connection.environment)}</strong></div>}
    {!owner
      ? <>
          {connection?.senderProfile && <div aria-label={t('ukrposhtaSettings.savedSender')}>
            <div className="delivery-account-summary"><span>{t('ukrposhtaSettings.sender')}</span><strong>{connection.senderProfile.senderName}</strong></div>
            <div className="delivery-account-summary"><span>{t('ukrposhtaSettings.phone')}</span><strong>{connection.senderProfile.senderPhone}</strong></div>
            <div className="delivery-account-summary"><span>{t('ukrposhtaSettings.branch')}</span><strong>{connection.senderProfile.origin.label}</strong></div>
            <div className="delivery-account-summary"><span>{t('ukrposhtaSettings.payer')}</span><strong>{connection.senderProfile.payer === 'SENDER' ? t('ukrposhtaSettings.sender') : t('ukrposhtaSettings.recipient')}</strong></div>
            <div className="delivery-account-summary"><span>{t('ukrposhtaSettings.defaultParcel')}</span><strong>{parcelSummary(t, formatNumber, connection.senderProfile)}</strong></div>
            <div className="delivery-account-summary"><span>{t('ukrposhtaSettings.suggestNotifications')}</span><strong>{connection.senderProfile.suggestCustomerNotification ? t('ukrposhtaSettings.yes') : t('ukrposhtaSettings.no')}</strong></div>
            <div className="delivery-account-summary"><span>{t('ukrposhtaSettings.template')}</span><strong>{connection.senderProfile.customerNotificationTemplate}</strong></div>
          </div>}
          <p className="delivery-readonly-note">{t('ukrposhtaSettings.ownerOnly')}</p>
        </>
      : <>
          <div className="delivery-connect-guide">
            <div><strong>{active ? t('ukrposhtaSettings.replaceAccessQuestion') : t('ukrposhtaSettings.agreementRequired')}</strong><span>{t('ukrposhtaSettings.accessHint')}</span></div>
            <a className="secondary-button" href="https://dev.ukrposhta.ua/" target="_blank" rel="noreferrer">{t('ukrposhtaSettings.apiDocs')}</a>
          </div>
          <div className="ukrposhta-connect-grid">
            <label><span>{t('ukrposhtaSettings.environmentField')}</span><select aria-label={t('ukrposhtaSettings.environmentField')} value={environment} onChange={(event) => setEnvironment(event.target.value as 'SANDBOX' | 'PRODUCTION')}><option value="SANDBOX">{t('ukrposhtaSettings.sandbox')}</option><option value="PRODUCTION">{t('ukrposhtaSettings.production')}</option></select></label>
            <label><span>eCom bearer</span><input id="ukrposhta-ecom" aria-label="eCom bearer" aria-invalid={Boolean(credentialErrors.ecom)} aria-describedby={credentialErrors.ecom ? 'ukrposhta-ecom-error' : undefined} autoComplete="new-password" type="password" value={ecomBearer} onChange={(event) => { setEcomBearer(event.target.value); setCredentialErrors((current) => clearFieldError(current, 'ecom')); }} /><FieldError id="ukrposhta-ecom-error" message={credentialErrors.ecom} /></label>
            <label><span>{t('ukrposhtaSettings.counterpartyToken')}</span><input id="ukrposhta-counterpartyToken" aria-label={t('ukrposhtaSettings.counterpartyToken')} aria-invalid={Boolean(credentialErrors.counterpartyToken)} aria-describedby={credentialErrors.counterpartyToken ? 'ukrposhta-counterparty-token-error' : undefined} autoComplete="new-password" type="password" value={counterpartyToken} onChange={(event) => { setCounterpartyToken(event.target.value); setCredentialErrors((current) => clearFieldError(current, 'counterpartyToken')); }} /><FieldError id="ukrposhta-counterparty-token-error" message={credentialErrors.counterpartyToken} /></label>
            <label><span>StatusTracking bearer</span><input id="ukrposhta-tracking" aria-label="StatusTracking bearer" aria-invalid={Boolean(credentialErrors.tracking)} aria-describedby={credentialErrors.tracking ? 'ukrposhta-tracking-error' : undefined} autoComplete="new-password" type="password" value={trackingBearer} onChange={(event) => { setTrackingBearer(event.target.value); setCredentialErrors((current) => clearFieldError(current, 'tracking')); }} /><FieldError id="ukrposhta-tracking-error" message={credentialErrors.tracking} /></label>
            <label><span>{t('ukrposhtaSettings.counterpartyUuid')}</span><input id="ukrposhta-counterpartyUuid" aria-label={t('ukrposhtaSettings.counterpartyUuid')} aria-invalid={Boolean(credentialErrors.counterpartyUuid)} aria-describedby={credentialErrors.counterpartyUuid ? 'ukrposhta-counterparty-uuid-error' : undefined} autoComplete="off" value={counterpartyUuid} onChange={(event) => { setCounterpartyUuid(event.target.value); setCredentialErrors((current) => clearFieldError(current, 'counterpartyUuid')); }} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" /><FieldError id="ukrposhta-counterparty-uuid-error" message={credentialErrors.counterpartyUuid} /></label>
          </div>
          {environment === 'PRODUCTION' && <p className="ukrposhta-production-warning"><strong>{t('ukrposhtaSettings.production')}</strong> {t('ukrposhtaSettings.productionWarning')}</p>}
          <p className="delivery-key-note">{t('ukrposhtaSettings.securityHint')}</p>
          <div className="settings-actions delivery-settings-actions">
            <LoadingButton type="button" pending={pending === 'connect'} pendingLabel={t('ukrposhtaSettings.connecting')} disabled={pending !== null} onClick={() => void connect()}>{active ? t('ukrposhtaSettings.replaceAccess') : t('ukrposhtaSettings.connect')}</LoadingButton>
            {active && <LoadingButton type="button" className="danger-button" pending={pending === 'disconnect'} pendingLabel={t('ukrposhtaSettings.disconnecting')} disabled={pending !== null} onClick={() => void disconnect()}>{t('ukrposhtaSettings.disconnect')}</LoadingButton>}
          </div>
          {active && <fieldset className="delivery-sender-form" disabled={pending !== null}>
            <legend>{t('ukrposhtaSettings.senderLegend')}</legend>
            <div className="ukrposhta-connect-grid">
              <label><span>{t('ukrposhtaSettings.senderName')}</span><input id="ukrposhta-sender-name" aria-label={t('ukrposhtaSettings.senderName')} aria-invalid={Boolean(senderErrors.name)} aria-describedby={senderErrors.name ? 'ukrposhta-sender-name-error' : undefined} value={profile.senderName} onChange={(event) => { setProfile((current) => ({ ...current, senderName: event.target.value })); setSenderErrors((current) => clearFieldError(current, 'name')); }} /><FieldError id="ukrposhta-sender-name-error" message={senderErrors.name} /></label>
              <p>{t('ukrposhtaSettings.personHint')}</p>
              <label><span>{t('ukrposhtaSettings.senderPhone')}</span><input id="ukrposhta-sender-phone" aria-label={t('ukrposhtaSettings.senderPhone')} aria-invalid={Boolean(senderErrors.phone)} aria-describedby={senderErrors.phone ? 'ukrposhta-sender-phone-error' : undefined} inputMode="tel" placeholder="+380501112233" value={profile.senderPhone} onChange={(event) => { setProfile((current) => ({ ...current, senderPhone: event.target.value })); setSenderErrors((current) => clearFieldError(current, 'phone')); }} /><FieldError id="ukrposhta-sender-phone-error" message={senderErrors.phone} /></label>
            </div>
            <div className="delivery-origin-grid">
              <DeliveryLocationPicker
                provider="UKRPOSHTA"
                label={t('ukrposhtaSettings.city')}
                type="CITY"
                value={city}
                onSelect={(value) => {
                  setCity(value);
                  setProfile((current) => value?.ref === current.origin.cityRef
                    ? current
                    : {
                        ...current,
                        origin: { type: 'BRANCH', cityRef: value?.ref ?? '', locationRef: '', label: '' },
                      });
                }}
              />
              <DeliveryLocationPicker
                fieldId="ukrposhta-sender-origin"
                fieldError={senderErrors.origin}
                provider="UKRPOSHTA"
                label={t('ukrposhtaSettings.originBranch')}
                type="BRANCH"
                {...(city?.ref || profile.origin.cityRef ? { cityRef: city?.ref ?? profile.origin.cityRef } : {})}
                value={profile.origin.locationRef ? { ref: profile.origin.locationRef, provider: 'UKRPOSHTA', type: 'BRANCH', label: profile.origin.label, cityRef: profile.origin.cityRef } : null}
                onSelect={(value) => { setSenderErrors((current) => clearFieldError(current, 'origin')); setProfile((current) => ({
                  ...current,
                  origin: value
                    ? { type: 'BRANCH', cityRef: value.cityRef!, locationRef: value.ref, label: value.label }
                    : { type: 'BRANCH', cityRef: city?.ref ?? '', locationRef: '', label: '' },
                })); }}
              />
            </div>
            <div className="delivery-parcel-grid">
              <NumberField id="ukrposhta-sender-weight" error={senderErrors.weight} label={t('ukrposhtaSettings.weight')} value={profile.defaultParcel.weightKg} max={1_000} onChange={(value) => { setProfile((current) => ({ ...current, defaultParcel: { ...current.defaultParcel, weightKg: value } })); setSenderErrors((current) => clearFieldError(current, 'weight')); }} />
              <NumberField id="ukrposhta-sender-length" error={senderErrors.length} label={t('ukrposhtaSettings.length')} value={profile.defaultParcel.lengthCm} max={300} onChange={(value) => { setProfile((current) => ({ ...current, defaultParcel: { ...current.defaultParcel, lengthCm: value } })); setSenderErrors((current) => clearFieldError(current, 'length')); }} />
              <NumberField id="ukrposhta-sender-width" error={senderErrors.width} label={t('ukrposhtaSettings.width')} value={profile.defaultParcel.widthCm} max={300} onChange={(value) => { setProfile((current) => ({ ...current, defaultParcel: { ...current.defaultParcel, widthCm: value } })); setSenderErrors((current) => clearFieldError(current, 'width')); }} />
              <NumberField id="ukrposhta-sender-height" error={senderErrors.height} label={t('ukrposhtaSettings.height')} value={profile.defaultParcel.heightCm} max={300} onChange={(value) => { setProfile((current) => ({ ...current, defaultParcel: { ...current.defaultParcel, heightCm: value } })); setSenderErrors((current) => clearFieldError(current, 'height')); }} />
            </div>
            <label><span>{t('ukrposhtaSettings.deliveryPayer')}</span><select aria-label={t('ukrposhtaSettings.deliveryPayer')} value={profile.payer} onChange={(event) => setProfile((current) => ({ ...current, payer: event.target.value as UkrposhtaSenderProfileInput['payer'] }))}><option value="SENDER">{t('ukrposhtaSettings.sender')}</option><option value="RECIPIENT">{t('ukrposhtaSettings.recipient')}</option></select></label>
            <label className="delivery-checkbox"><input type="checkbox" checked={profile.suggestCustomerNotification} onChange={(event) => setProfile((current) => ({ ...current, suggestCustomerNotification: event.target.checked }))} /><span>{t('ukrposhtaSettings.suggestMessage')}</span></label>
            <label><span>{t('ukrposhtaSettings.messageTemplate')}</span><textarea id="ukrposhta-sender-template" aria-label={t('ukrposhtaSettings.messageTemplate')} aria-invalid={Boolean(senderErrors.template)} aria-describedby={senderErrors.template ? 'ukrposhta-sender-template-error' : undefined} value={profile.customerNotificationTemplate} onChange={(event) => { setProfile((current) => ({ ...current, customerNotificationTemplate: event.target.value })); setSenderErrors((current) => clearFieldError(current, 'template')); }} /><FieldError id="ukrposhta-sender-template-error" message={senderErrors.template} /></label>
            <div className="settings-actions delivery-settings-actions"><LoadingButton type="button" pending={pending === 'profile'} pendingLabel={t('ukrposhtaSettings.saving')} disabled={pending !== null} onClick={() => void saveProfile()}>{t('ukrposhtaSettings.saveSender')}</LoadingButton></div>
          </fieldset>}
        </>}
  </section>;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function statusLabel(t: Translator, status: UkrposhtaConnectionSummary['status'] | undefined): string {
  if (!status) return t('ukrposhtaSettings.statusNotConnected');
  return ({ ACTIVE: t('ukrposhtaSettings.statusActive'), NEEDS_ATTENTION: t('ukrposhtaSettings.statusNeedsAttention'), DISCONNECTED: t('ukrposhtaSettings.statusDisconnected') } as const)[status];
}

function environmentLabel(t: Translator, environment: NonNullable<UkrposhtaConnectionSummary['environment']>): string {
  return environment === 'SANDBOX' ? t('ukrposhtaSettings.sandbox') : t('ukrposhtaSettings.production');
}

async function jsonOrNull(response: Response): Promise<unknown> {
  try { return await response.json(); }
  catch { return null; }
}

function isUkrposhtaConnection(value: unknown): value is UkrposhtaConnectionSummary {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.provider === 'UKRPOSHTA'
    && (record.status === 'ACTIVE' || record.status === 'NEEDS_ATTENTION' || record.status === 'DISCONNECTED')
    && (typeof record.accountLabel === 'string' || record.accountLabel === null)
    && (typeof record.lastVerifiedAt === 'string' || record.lastVerifiedAt === null)
    && (typeof record.lastErrorCode === 'string' || record.lastErrorCode === null)
    && (record.environment === 'SANDBOX' || record.environment === 'PRODUCTION' || record.environment === null)
    && (record.senderProfile === null || isUkrposhtaSenderProfile(record.senderProfile));
}

function isUkrposhtaSenderProfile(value: unknown): value is UkrposhtaSenderProfileInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const profile = value as Record<string, unknown>;
  return typeof profile.senderName === 'string' && typeof profile.senderPhone === 'string'
    && typeof profile.origin === 'object' && profile.origin !== null
    && typeof profile.defaultParcel === 'object' && profile.defaultParcel !== null
    && (profile.payer === 'SENDER' || profile.payer === 'RECIPIENT')
    && typeof profile.suggestCustomerNotification === 'boolean'
    && typeof profile.customerNotificationTemplate === 'string';
}

function parcelSummary(t: Translator, formatNumber: ReturnType<typeof useI18n>['formatNumber'], profile: UkrposhtaSenderProfileInput): string {
  const parcel = profile.defaultParcel;
  return t('ukrposhtaSettings.parcelSummary', { weight: formatNumber(parcel.weightKg), length: formatNumber(parcel.lengthCm), width: formatNumber(parcel.widthCm), height: formatNumber(parcel.heightCm) });
}

function citySelectionFromProfile(profile: UkrposhtaSenderProfileInput | null | undefined): DeliveryLocation | null {
  if (!profile?.origin.cityRef) return null;
  return { ref: profile.origin.cityRef, provider: 'UKRPOSHTA', type: 'CITY', label: '' };
}

function NumberField({ id, error, label, value, max, onChange }: { id: string; error?: string | undefined; label: string; value: number; max: number; onChange(value: number): void }) {
  return <label><span>{label}</span><input id={id} aria-label={label} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} type="number" min="0.01" max={max} step="0.01" value={value} onChange={(event) => onChange(Number(event.target.value))} /><FieldError id={`${id}-error`} message={error} /></label>;
}
