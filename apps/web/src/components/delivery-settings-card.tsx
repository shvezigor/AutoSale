'use client';

import type { DeliveryConnectionSummary, DeliveryLocation, DeliverySenderProfileInput } from '../../../../packages/contracts/src/delivery';
import { useCallback, useEffect, useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';
import { useI18n } from '../i18n/i18n-provider';
import type { Translator } from '../i18n/translator';
import { useActivity } from './activity-provider';
import { useConfirm } from './confirm-provider';
import { DeliveryLocationPicker } from './delivery-location-picker';
import { LoadingButton } from './loading-button';
import { useToast } from './toast-provider';

export type DeliverySettingsSummary = {
  enabled: boolean;
  connections: DeliveryConnectionSummary[];
};

type PendingAction = 'connect' | 'save' | 'disconnect' | null;
type SenderOption = {
  ref: string;
  label: string;
  edrpou: string | null;
  contacts: Array<{ ref: string; label: string; phone: string }>;
  origins: Array<{ ref: string; cityRef: string; label: string; number: string; type: 'BRANCH' | 'PARCEL_LOCKER' }>;
};

const emptyProfileBase: Omit<DeliverySenderProfileInput, 'customerNotificationTemplate'> = {
  senderRef: '',
  contactRef: '',
  contactPhone: '+380',
  origin: { type: 'BRANCH', cityRef: '', locationRef: '', label: '' },
  payer: 'SENDER',
  defaultParcel: { weightKg: 1, lengthCm: 20, widthCm: 20, heightCm: 20 },
  suggestCustomerNotification: true,
};

export function DeliverySettingsCard({
  initial,
  role,
  embedded = false,
  onConnectionChange,
}: {
  initial: DeliverySettingsSummary;
  role: 'OWNER' | 'MANAGER';
  embedded?: boolean;
  onConnectionChange?(connection: DeliveryConnectionSummary | null): void;
}) {
  const { t } = useI18n();
  const emptyProfile: DeliverySenderProfileInput = { ...emptyProfileBase, customerNotificationTemplate: t('novaPoshtaSettings.defaultTemplate') };
  const [connection, setConnection] = useState<DeliveryConnectionSummary | null>(initial.connections[0] ?? null);
  const [profile, setProfile] = useState<DeliverySenderProfileInput>(initial.connections[0]?.senderProfile ?? emptyProfile);
  const [apiKey, setApiKey] = useState('');
  const [pending, setPending] = useState<PendingAction>(null);
  const [senderOptions, setSenderOptions] = useState<SenderOption[]>([]);
  const [originCity, setOriginCity] = useState<DeliveryLocation | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const activity = useActivity();
  const confirm = useConfirm();
  const toast = useToast();
  const owner = role === 'OWNER';
  const active = connection?.status === 'ACTIVE';
  const selectedSender = senderOptions.find((option) => option.ref === profile.senderRef) ?? null;

  const loadSenderOptions = useCallback(async () => {
    if (!owner) return;
    setLoadingOptions(true);
    try {
      const response = await fetch('/api/integrations/delivery/nova-poshta/sender-options', { credentials: 'same-origin' });
      const payload = await jsonOrNull(response);
      if (response.ok && isSenderOptions(payload)) {
        setSenderOptions(payload);
        setProfile((current) => current.senderRef || payload.length !== 1
          ? current
          : profileFromOnlySender(current, payload[0]!));
      }
    } catch {
      // The saved profile remains usable when the provider directory is temporarily unavailable.
    } finally {
      setLoadingOptions(false);
    }
  }, [owner]);

  useEffect(() => {
    if (active) void loadSenderOptions();
  }, [active, loadSenderOptions]);

  async function connect() {
    const normalizedKey = apiKey.trim();
    if (normalizedKey.length < 8) {
      toast.show({ type: 'error', title: t('novaPoshtaSettings.invalidKey') });
      return;
    }
    setPending('connect');
    try {
      const response = await activity.run(t('novaPoshtaSettings.connectingActivity'), () => mutatingFetch('/api/integrations/delivery/nova-poshta', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: normalizedKey }),
      }));
      const payload = await jsonOrNull(response);
      if (!response.ok || !isConnectionSummary(payload)) throw new Error('connection failed');
      setConnection(payload);
      onConnectionChange?.(payload);
      setProfile(payload.senderProfile ?? emptyProfile);
      setApiKey('');
      toast.show({ type: 'success', title: t('novaPoshtaSettings.connected') });
      void loadSenderOptions();
    } catch {
      setApiKey('');
      toast.show({
        type: 'error',
        title: t('novaPoshtaSettings.connectFailed'),
        message: t('novaPoshtaSettings.connectFailedHint'),
      });
    } finally {
      setPending(null);
    }
  }

  async function saveProfile() {
    setPending('save');
    try {
      const response = await activity.run(t('novaPoshtaSettings.savingSender'), () => mutatingFetch(
        '/api/integrations/delivery/nova-poshta/sender-profile',
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(profile),
        },
      ));
      if (!response.ok) throw new Error('save failed');
      const next = connection ? { ...connection, senderProfile: profile } : null;
      setConnection(next);
      onConnectionChange?.(next);
      toast.show({ type: 'success', title: t('novaPoshtaSettings.senderSaved') });
    } catch {
      toast.show({
        type: 'error',
        title: t('novaPoshtaSettings.senderSaveFailed'),
        message: t('novaPoshtaSettings.senderSaveFailedHint'),
      });
    } finally {
      setPending(null);
    }
  }

  async function disconnect() {
    const approved = await confirm({
      title: t('novaPoshtaSettings.disconnectTitle'),
      description: t('novaPoshtaSettings.disconnectDescription'),
      confirmLabel: t('novaPoshtaSettings.confirmDisconnect'),
      tone: 'danger',
    });
    if (!approved) return;
    setPending('disconnect');
    try {
      const response = await activity.run(t('novaPoshtaSettings.disconnectingActivity'), () => mutatingFetch('/api/integrations/delivery/nova-poshta', { method: 'DELETE' }));
      if (!response.ok) throw new Error('disconnect failed');
      setConnection(null);
      onConnectionChange?.(null);
      setProfile(emptyProfile);
      setOriginCity(null);
      toast.show({ type: 'success', title: t('novaPoshtaSettings.disconnected') });
    } catch {
      toast.show({ type: 'error', title: t('novaPoshtaSettings.disconnectFailed') });
    } finally {
      setPending(null);
    }
  }

  if (!initial.enabled) return <section className="settings-card delivery-settings-card">
    <div className="settings-card-heading"><div><h2>{t('novaPoshtaSettings.provider')}</h2><p>{t('novaPoshtaSettings.unavailableDescription')}</p></div><span className="connection-status status-not_connected">{t('novaPoshtaSettings.unavailable')}</span></div>
  </section>;

  return <section className={`settings-card delivery-settings-card ${embedded ? 'is-embedded' : ''}`} {...(embedded ? { 'aria-label': t('novaPoshtaSettings.provider') } : { 'aria-labelledby': 'delivery-settings-title' })} aria-busy={pending !== null || undefined}>
    {!embedded && <div className="settings-card-heading">
      <div>
        <h2 id="delivery-settings-title">{t('novaPoshtaSettings.provider')}</h2>
        <p>{t('novaPoshtaSettings.description')}</p>
      </div>
      <span className={`connection-status status-${(connection?.status ?? 'NOT_CONNECTED').toLowerCase()}`}>
        {statusLabel(t, connection?.status)}
      </span>
    </div>}

    {embedded && <div className="delivery-panel-section-heading"><span>{t('novaPoshtaSettings.connection')}</span><p>{t('novaPoshtaSettings.connectionDescription')}</p></div>}

    {connection?.accountLabel && <div className="delivery-account-summary"><span>{t('novaPoshtaSettings.senderCabinet')}</span><strong>{connection.accountLabel}</strong></div>}

    {!owner ? <p className="delivery-readonly-note">{t('novaPoshtaSettings.ownerOnly')}</p> : <>
      <div className="delivery-connect-guide">
        <div><strong>{active ? t('novaPoshtaSettings.replaceKeyQuestion') : t('novaPoshtaSettings.quickSetup')}</strong><span>{t('novaPoshtaSettings.keyInstructions')}</span></div>
        <a className="secondary-button" href="https://my.novaposhta.ua/settings/index#apikeys" target="_blank" rel="noreferrer">{t('novaPoshtaSettings.openKeySettings')}</a>
      </div>
      <div className="delivery-connect-form">
        <label>
          <span>{t('novaPoshtaSettings.apiKey')}</span>
          <input aria-label={t('novaPoshtaSettings.apiKey')} autoComplete="off" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={active ? t('novaPoshtaSettings.replaceKeyPlaceholder') : t('novaPoshtaSettings.keyPlaceholder')} />
        </label>
        <LoadingButton type="button" pending={pending === 'connect'} pendingLabel={t('novaPoshtaSettings.connecting')} disabled={pending !== null || apiKey.trim().length < 8} onClick={() => void connect()}>
          {active ? t('novaPoshtaSettings.replaceKey') : t('novaPoshtaSettings.connect')}
        </LoadingButton>
      </div>
      <p className="delivery-key-note">{t('novaPoshtaSettings.keySecurity')}</p>

      {active && <>
        <fieldset className="delivery-sender-form" disabled={pending !== null}>
          <legend>{t('novaPoshtaSettings.senderData')}</legend>
          <div className="delivery-form-grid">
            <SelectField label={t('novaPoshtaSettings.sender')} value={profile.senderRef} loading={loadingOptions} options={senderOptions.map((sender) => ({ value: sender.ref, label: sender.label }))} onChange={(value) => {
              const sender = senderOptions.find((option) => option.ref === value);
              const contact = sender?.contacts[0];
              const origin = sender?.origins[0];
              setOriginCity(null);
              setProfile({
                ...profile,
                senderRef: value,
                contactRef: contact?.ref ?? '',
                contactPhone: contact?.phone ?? '+380',
                origin: origin ? { type: origin.type, cityRef: origin.cityRef, locationRef: origin.ref, label: origin.label } : emptyProfile.origin,
              });
            }} />
            <SelectField label={t('novaPoshtaSettings.contact')} value={profile.contactRef} loading={loadingOptions} options={(selectedSender?.contacts ?? []).map((contact) => ({ value: contact.ref, label: contact.label }))} onChange={(value) => {
              const contact = selectedSender?.contacts.find((option) => option.ref === value);
              setProfile({ ...profile, contactRef: value, contactPhone: contact?.phone ?? profile.contactPhone });
            }} />
            <TextField label={t('novaPoshtaSettings.senderPhone')} value={profile.contactPhone} onChange={(value) => setProfile({ ...profile, contactPhone: value })} />
            {selectedSender && selectedSender.origins.length === 0
              ? profile.origin.type !== 'ADDRESS' && profile.origin.locationRef && profile.origin.label
                ? <div className="delivery-origin-summary">
                    <span>{t('novaPoshtaSettings.origin')}</span>
                    <strong>{profile.origin.label}</strong>
                    <button type="button" className="text-button" onClick={() => {
                      setOriginCity(null);
                      setProfile({ ...profile, origin: { type: 'BRANCH', cityRef: '', locationRef: '', label: '' } });
                    }}>{t('novaPoshtaSettings.changeOrigin')}</button>
                  </div>
                : <>
                    <DeliveryLocationPicker
                      label={t('novaPoshtaSettings.originCity')}
                      type="CITY"
                      value={originCity}
                      onSelect={(city) => {
                        setOriginCity(city);
                        setProfile({ ...profile, origin: { type: profile.origin.type === 'PARCEL_LOCKER' ? 'PARCEL_LOCKER' : 'BRANCH', cityRef: city?.ref ?? '', locationRef: '', label: '' } });
                      }}
                    />
                    <label>
                      <span>{t('novaPoshtaSettings.pointType')}</span>
                      <select aria-label={t('novaPoshtaSettings.originType')} value={profile.origin.type === 'PARCEL_LOCKER' ? 'PARCEL_LOCKER' : 'BRANCH'} onChange={(event) => setProfile({
                        ...profile,
                        origin: { type: event.target.value as 'BRANCH' | 'PARCEL_LOCKER', cityRef: originCity?.ref ?? '', locationRef: '', label: '' },
                      })}>
                        <option value="BRANCH">{t('novaPoshtaSettings.branch')}</option>
                        <option value="PARCEL_LOCKER">{t('novaPoshtaSettings.parcelLocker')}</option>
                      </select>
                    </label>
                    <DeliveryLocationPicker
                      label={t('novaPoshtaSettings.origin')}
                      type={profile.origin.type === 'PARCEL_LOCKER' ? 'PARCEL_LOCKER' : 'BRANCH'}
                      cityRef={originCity?.ref ?? ''}
                      value={null}
                      onSelect={(origin) => {
                        if (origin && (origin.type === 'BRANCH' || origin.type === 'PARCEL_LOCKER')) {
                          setProfile({ ...profile, origin: { type: origin.type, cityRef: origin.cityRef ?? originCity?.ref ?? '', locationRef: origin.ref, label: origin.label } });
                        }
                      }}
                    />
                  </>
              : <SelectField label={t('novaPoshtaSettings.origin')} value={profile.origin.type === 'ADDRESS' ? '' : profile.origin.locationRef} loading={loadingOptions} options={(selectedSender?.origins ?? []).map((origin) => ({ value: origin.ref, label: origin.label }))} onChange={(value) => {
                  const origin = selectedSender?.origins.find((option) => option.ref === value);
                  if (origin) setProfile({ ...profile, origin: { type: origin.type, cityRef: origin.cityRef, locationRef: origin.ref, label: origin.label } });
                }} />}
            <label><span>{t('novaPoshtaSettings.deliveryPayer')}</span><select aria-label={t('novaPoshtaSettings.deliveryPayer')} value={profile.payer} onChange={(event) => setProfile({ ...profile, payer: event.target.value as 'SENDER' | 'RECIPIENT' })}><option value="SENDER">{t('novaPoshtaSettings.sender')}</option><option value="RECIPIENT">{t('novaPoshtaSettings.recipient')}</option></select></label>
          </div>
          <div className="delivery-parcel-grid">
            <NumberField label={t('novaPoshtaSettings.weight')} value={profile.defaultParcel.weightKg} onChange={(value) => setProfile({ ...profile, defaultParcel: { ...profile.defaultParcel, weightKg: value } })} />
            <NumberField label={t('novaPoshtaSettings.length')} value={profile.defaultParcel.lengthCm} onChange={(value) => setProfile({ ...profile, defaultParcel: { ...profile.defaultParcel, lengthCm: value } })} />
            <NumberField label={t('novaPoshtaSettings.width')} value={profile.defaultParcel.widthCm} onChange={(value) => setProfile({ ...profile, defaultParcel: { ...profile.defaultParcel, widthCm: value } })} />
            <NumberField label={t('novaPoshtaSettings.height')} value={profile.defaultParcel.heightCm} onChange={(value) => setProfile({ ...profile, defaultParcel: { ...profile.defaultParcel, heightCm: value } })} />
          </div>
          <label className="delivery-notification-toggle"><input type="checkbox" checked={profile.suggestCustomerNotification} onChange={(event) => setProfile({ ...profile, suggestCustomerNotification: event.target.checked })} />{t('novaPoshtaSettings.suggestNotification')}</label>
          <label className="delivery-notification-template">
            <span>{t('novaPoshtaSettings.notificationTemplate')}</span>
            <textarea
              aria-label={t('novaPoshtaSettings.notificationTemplate')}
              maxLength={1_000}
              rows={4}
              value={profile.customerNotificationTemplate}
              onChange={(event) => setProfile({ ...profile, customerNotificationTemplate: event.target.value })}
            />
            <small>{t('novaPoshtaSettings.availableFields', { fields: '{company}, {trackingNumber}, {trackingUrl}', length: profile.customerNotificationTemplate.length })}</small>
          </label>
        </fieldset>
        <div className="settings-actions delivery-settings-actions">
          <LoadingButton type="button" pending={pending === 'save'} pendingLabel={t('novaPoshtaSettings.saving')} disabled={pending !== null} onClick={() => void saveProfile()}>{t('novaPoshtaSettings.saveSender')}</LoadingButton>
          <LoadingButton type="button" className="danger-button" pending={pending === 'disconnect'} pendingLabel={t('novaPoshtaSettings.disconnecting')} disabled={pending !== null} onClick={() => void disconnect()}>{t('novaPoshtaSettings.disconnect')}</LoadingButton>
        </div>
      </>}
    </>}
  </section>;
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) {
  return <label><span>{label}</span><input aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function SelectField({ label, value, options, loading, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; loading: boolean; onChange(value: string): void }) {
  const { t } = useI18n();
  const includesCurrent = options.some((option) => option.value === value);
  return <label><span>{label}</span><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} disabled={loading}>
    <option value="">{loading ? t('novaPoshtaSettings.loading') : t('novaPoshtaSettings.chooseFromList')}</option>
    {!includesCurrent && value && <option value={value}>{value}</option>}
    {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select></label>;
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange(value: number): void }) {
  return <label><span>{label}</span><input aria-label={label} type="number" min="0.01" step="0.01" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function statusLabel(t: Translator, status: DeliveryConnectionSummary['status'] | undefined): string {
  if (!status) return t('novaPoshtaSettings.statusNotConnected');
  return ({ ACTIVE: t('novaPoshtaSettings.statusActive'), NEEDS_ATTENTION: t('novaPoshtaSettings.statusNeedsAttention'), DISCONNECTED: t('novaPoshtaSettings.statusDisconnected') } as const)[status];
}

async function jsonOrNull(response: Response): Promise<unknown> {
  try { return await response.json(); }
  catch { return null; }
}

function isConnectionSummary(value: unknown): value is DeliveryConnectionSummary {
  if (!isRecord(value)) return false;
  return value.provider === 'NOVA_POSHTA'
    && (value.status === 'ACTIVE' || value.status === 'NEEDS_ATTENTION' || value.status === 'DISCONNECTED')
    && (typeof value.accountLabel === 'string' || value.accountLabel === null)
    && (typeof value.lastVerifiedAt === 'string' || value.lastVerifiedAt === null)
    && (typeof value.lastErrorCode === 'string' || value.lastErrorCode === null)
    && (isRecord(value.senderProfile) || value.senderProfile === null);
}

function isSenderOptions(value: unknown): value is SenderOption[] {
  return Array.isArray(value) && value.every((sender) => isRecord(sender)
    && typeof sender.ref === 'string'
    && typeof sender.label === 'string'
    && Array.isArray(sender.contacts)
    && sender.contacts.every((contact) => isRecord(contact) && typeof contact.ref === 'string' && typeof contact.label === 'string' && typeof contact.phone === 'string')
    && Array.isArray(sender.origins)
    && sender.origins.every((origin) => isRecord(origin) && typeof origin.ref === 'string' && typeof origin.cityRef === 'string' && typeof origin.label === 'string'));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function profileFromOnlySender(current: DeliverySenderProfileInput, sender: SenderOption): DeliverySenderProfileInput {
  const contact = sender.contacts[0];
  const origin = sender.origins[0];
  return {
    ...current,
    senderRef: sender.ref,
    contactRef: contact?.ref ?? '',
    contactPhone: contact?.phone ?? current.contactPhone,
    origin: origin
      ? { type: origin.type, cityRef: origin.cityRef, locationRef: origin.ref, label: origin.label }
      : current.origin,
  };
}
