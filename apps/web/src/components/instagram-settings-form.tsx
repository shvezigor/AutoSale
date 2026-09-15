'use client';

import type { InstagramConnectionSummary as ContractInstagramConnectionSummary } from '../../../../packages/contracts/src/instagram';
import { useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';
import { useI18n } from '../i18n/i18n-provider';
import type { Translator } from '../i18n/translator';
import { useActivity } from './activity-provider';
import { useToast } from './toast-provider';

export type InstagramConnectionSummary = ContractInstagramConnectionSummary;

type MembershipRole = 'OWNER' | 'MANAGER' | null;
type Message = { kind: 'success' | 'error'; text: string } | null;
type PendingAction = 'connect' | 'disconnect' | 'cleanup' | 'deadLetter' | null;
type WizardStep = 'prepare' | 'authorize' | null;

const META_AUTHORIZATION_ORIGIN = 'https://www.instagram.com';
const CONNECTION_STATUSES = new Set<InstagramConnectionSummary['status']>([
  'NOT_CONNECTED',
  'LEGACY',
  'ACTIVE',
  'REAUTH_REQUIRED',
  'ERROR',
  'DISCONNECTED',
]);

export function InstagramSettingsForm({
  initial,
  membershipRole,
  embedded = false,
  onConnectionChange,
}: {
  initial: InstagramConnectionSummary;
  membershipRole: MembershipRole;
  embedded?: boolean;
  onConnectionChange?: (connection: InstagramConnectionSummary) => void;
}) {
  const { t, formatDate } = useI18n();
  const [connection, setConnection] = useState(initial);
  const [message, setMessage] = useState<Message>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [confirmingDeadLetter, setConfirmingDeadLetter] = useState(false);
  const [wizardStep, setWizardStep] = useState<WizardStep>(null);
  const isOwner = membershipRole === 'OWNER';
  const pending = pendingAction !== null;
  const cleanupPending = isCleanupPending(connection);
  const cleanupCanBeAbandoned = connection.cleanupStatus === 'FAILED' &&
    (isPermanentCleanupFailure(connection) || connection.cleanupAbandonEligible);
  const actionLabel = connectionActionLabel(t, connection.status);
  const visibleErrorCode = connection.cleanupErrorCode ?? connection.lastErrorCode;
  const activity = useActivity();
  const toast = useToast();

  function updateConnection(next: InstagramConnectionSummary) {
    setConnection(next);
    onConnectionChange?.(next);
  }

  async function connect() {
    setPendingAction('connect');
    setMessage(null);
    try {
      const response = await activity.run(t('instagramSettings.connectingActivity'), () => mutatingFetch('/api/integrations/instagram/connect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ returnPath: '/settings' }),
      }));
      const payload = await jsonOrNull(response);
      const authorizationUrl = isRecord(payload) ? payload.authorizationUrl : null;
      if (!response.ok || typeof authorizationUrl !== 'string' || !isTrustedMetaAuthorizationUrl(authorizationUrl)) {
        throw new Error('connect failed');
      }
      window.location.href = authorizationUrl;
    } catch {
      setMessage({ kind: 'error', text: t('instagramSettings.connectStartFailed') });
      toast.show({ type: 'error', title: t('instagramSettings.connectFailed') });
    } finally {
      setPendingAction(null);
    }
  }

  async function disconnect() {
    setPendingAction('disconnect');
    setMessage(null);
    try {
      const response = await activity.run(t('instagramSettings.disconnectingActivity'), () => mutatingFetch('/api/integrations/instagram/disconnect', { method: 'POST' }));
      const payload = await jsonOrNull(response);
      if (!response.ok || !isInstagramConnectionSummary(payload)) throw new Error('disconnect failed');
      updateConnection(payload);
      setConfirmingDisconnect(false);
      setConfirmingDeadLetter(false);
      setMessage({ kind: 'success', text: t('instagramSettings.disconnected') });
      toast.show({ type: 'success', title: t('instagramSettings.disconnected') });
    } catch {
      setMessage({ kind: 'error', text: t('instagramSettings.disconnectFailed') });
      toast.show({ type: 'error', title: t('instagramSettings.disconnectFailed') });
    } finally {
      setPendingAction(null);
    }
  }

  async function retryCleanup() {
    setPendingAction('cleanup');
    setMessage(null);
    try {
      const response = await activity.run(t('instagramSettings.cleaningActivity'), () => mutatingFetch('/api/integrations/instagram/cleanup', { method: 'POST' }));
      const payload = await jsonOrNull(response);
      if (!response.ok || !isInstagramConnectionSummary(payload)) throw new Error('cleanup failed');
      updateConnection(payload);
      if (isCleanupPending(payload)) throw new Error('cleanup failed');
      setMessage({ kind: 'success', text: t('instagramSettings.cleanupComplete') });
      toast.show({ type: 'success', title: t('instagramSettings.cleanupComplete') });
    } catch {
      setMessage({ kind: 'error', text: t('instagramSettings.cleanupFailed') });
      toast.show({ type: 'error', title: t('instagramSettings.cleanupFailedShort') });
    } finally {
      setPendingAction(null);
    }
  }

  async function deadLetterCleanup() {
    setPendingAction('deadLetter');
    setMessage(null);
    try {
      const response = await activity.run(t('instagramSettings.unlockingActivity'), () => mutatingFetch('/api/integrations/instagram/cleanup/dead-letter', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmation: 'ABANDON_REMOTE_CLEANUP' }),
      }));
      const payload = await jsonOrNull(response);
      if (!response.ok || !isInstagramConnectionSummary(payload) || isCleanupPending(payload)) throw new Error('dead letter failed');
      updateConnection(payload);
      setConfirmingDeadLetter(false);
      setMessage({ kind: 'success', text: t('instagramSettings.unlocked') });
      toast.show({ type: 'success', title: t('instagramSettings.unlockedShort') });
    } catch {
      setMessage({ kind: 'error', text: t('instagramSettings.unlockFailed') });
      toast.show({ type: 'error', title: t('instagramSettings.unlockFailedShort') });
    } finally {
      setPendingAction(null);
    }
  }

  const visibleStatus = pendingAction === 'connect' ? t('instagramSettings.connecting') : instagramConnectionStatusLabel(t, connection.status);

  return <section className={`settings-card instagram-connection-card ${embedded ? 'is-embedded' : ''}`} aria-busy={pending || undefined} {...(embedded ? { 'aria-label': 'Instagram' } : { 'aria-labelledby': 'instagram-connection-title' })}>
    {!embedded && <div className="settings-card-heading">
      <div>
        <h2 id="instagram-connection-title">Instagram</h2>
        <p>{t('instagramSettings.description')}</p>
      </div>
      <span className={`connection-status status-${connection.status.toLowerCase()}`} aria-label={t('instagramSettings.statusLabel', { status: visibleStatus })} role={pendingAction === 'connect' ? 'status' : undefined}>
        {visibleStatus}
      </span>
    </div>}
    {embedded && <div className="delivery-panel-section-heading"><span>{t('instagramSettings.connectionSection')}</span><p>{t('instagramSettings.connectionSectionDescription')}</p></div>}

    <dl className="instagram-connection-details">
      <div><dt>{t('instagramSettings.account')}</dt><dd>{connection.username ? `@${connection.username}` : t('instagramSettings.notConnectedYet')}</dd></div>
      <div><dt>{t('instagramSettings.lastCheck')}</dt><dd>{formatVerificationDate(t, formatDate, connection.lastVerifiedAt)}</dd></div>
      {visibleErrorCode && <div><dt>{t('instagramSettings.state')}</dt><dd>{safeErrorCode(t, visibleErrorCode)}</dd></div>}
    </dl>

    {membershipRole === 'MANAGER' && <p className="sheets-hint">{t('instagramSettings.managerReadonly')}</p>}

    {isOwner && <div className="settings-actions instagram-connection-actions">
      {actionLabel && !cleanupPending && wizardStep === null && <button disabled={pending} onClick={() => setWizardStep('prepare')} type="button">{actionLabel}</button>}
      {cleanupPending && <button disabled={pending} onClick={() => void retryCleanup()} type="button">{t('instagramSettings.retryCleanup')}</button>}
      {cleanupCanBeAbandoned && !confirmingDeadLetter && <button className="secondary-button" disabled={pending} onClick={() => { setConfirmingDisconnect(false); setConfirmingDeadLetter(true); }} type="button">{t('instagramSettings.unlockConnection')}</button>}
      {canDisconnect(connection.status) && !confirmingDisconnect && <button className="danger-button" disabled={pending} onClick={() => setConfirmingDisconnect(true)} type="button">{t('instagramSettings.disconnect')}</button>}
      {wizardStep && <div className="instagram-connect-wizard" role="dialog" aria-labelledby="instagram-wizard-title">
        <div className="instagram-wizard-progress" aria-label={t('instagramSettings.wizardProgress')}>
          <span className={wizardStep === 'prepare' ? 'is-current' : 'is-complete'}>1</span>
          <i />
          <span className={wizardStep === 'authorize' ? 'is-current' : ''}>2</span>
          <i />
          <span>3</span>
        </div>
        {wizardStep === 'prepare' ? <>
          <div className="instagram-wizard-copy">
            <small>{t('instagramSettings.stepOne')}</small>
            <h3 id="instagram-wizard-title">{t('instagramSettings.connectTitle')}</h3>
            <p>{t('instagramSettings.prepareDescription')}</p>
          </div>
          <ul className="instagram-wizard-checklist">
            <li><strong>{t('instagramSettings.professionalAccount')}</strong><span>{t('instagramSettings.professionalAccountHint')}</span></li>
            <li><strong>{t('instagramSettings.ownerAccess')}</strong><span>{t('instagramSettings.ownerAccessHint')}</span></li>
            <li><strong>{t('instagramSettings.secureMetaLogin')}</strong><span>{t('instagramSettings.secureMetaLoginHint')}</span></li>
          </ul>
          <div className="instagram-wizard-actions">
            <button className="secondary-button" onClick={() => setWizardStep(null)} type="button">{t('instagramSettings.cancel')}</button>
            <button onClick={() => setWizardStep('authorize')} type="button">{t('instagramSettings.continue')}</button>
          </div>
        </> : <>
          <div className="instagram-wizard-copy">
            <small>{t('instagramSettings.stepTwo')}</small>
            <h3 id="instagram-wizard-title">{t('instagramSettings.permissionsTitle')}</h3>
            <p>{t('instagramSettings.permissionsDescription')}</p>
          </div>
          <div className="instagram-wizard-note"><strong>{t('instagramSettings.savedData')}</strong><span>{t('instagramSettings.savedDataDescription')}</span></div>
          <div className="instagram-wizard-actions">
            <button className="secondary-button" disabled={pending} onClick={() => setWizardStep('prepare')} type="button">{t('instagramSettings.back')}</button>
            <button disabled={pending} onClick={() => void connect()} type="button">{t('instagramSettings.connectMeta')}</button>
          </div>
        </>}
      </div>}
      {confirmingDisconnect && <div className="instagram-disconnect-confirmation" role="alert">
        <span>{t('instagramSettings.disconnectConfirm')}</span>
        <div>
          <button className="secondary-button" disabled={pending} onClick={() => setConfirmingDisconnect(false)} type="button">{t('instagramSettings.cancel')}</button>
          <button className="danger-button" disabled={pending} onClick={() => void disconnect()} type="button">{t('instagramSettings.confirmDisconnect')}</button>
        </div>
      </div>}
      {confirmingDeadLetter && <div className="instagram-disconnect-confirmation" role="alert">
        <span>{t('instagramSettings.unlockConfirm')}</span>
        <div>
          <button className="secondary-button" disabled={pending} onClick={() => setConfirmingDeadLetter(false)} type="button">{t('instagramSettings.cancel')}</button>
          <button className="danger-button" disabled={pending} onClick={() => void deadLetterCleanup()} type="button">{t('instagramSettings.confirmUnlock')}</button>
        </div>
      </div>}
      {message && <span className={message.kind === 'error' ? 'save-error' : 'save-success'} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</span>}
    </div>}
  </section>;
}

export function isTrustedMetaAuthorizationUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === META_AUTHORIZATION_ORIGIN && url.protocol === 'https:';
  } catch {
    return false;
  }
}

function connectionActionLabel(t: Translator, status: InstagramConnectionSummary['status']): string | null {
  if (status === 'NOT_CONNECTED' || status === 'DISCONNECTED') return t('instagramSettings.connect');
  if (status === 'LEGACY' || status === 'REAUTH_REQUIRED' || status === 'ERROR') return t('instagramSettings.reconnect');
  return null;
}

function isCleanupPending(connection: InstagramConnectionSummary): boolean {
  return connection.cleanupStatus === 'PENDING' || connection.cleanupStatus === 'FAILED';
}

function isPermanentCleanupFailure(connection: InstagramConnectionSummary): boolean {
  return connection.cleanupStatus === 'FAILED' && connection.cleanupErrorCode === 'META_CLEANUP_PERMANENT_FAILURE';
}

function canDisconnect(status: InstagramConnectionSummary['status']): boolean {
  return status === 'ACTIVE' || status === 'LEGACY' || status === 'REAUTH_REQUIRED' || status === 'ERROR';
}

export function instagramConnectionStatusLabel(t: Translator, status: InstagramConnectionSummary['status']): string {
  return {
    NOT_CONNECTED: t('instagramSettings.statusNotConnected'),
    LEGACY: t('instagramSettings.statusReauth'),
    ACTIVE: t('instagramSettings.statusActive'),
    REAUTH_REQUIRED: t('instagramSettings.statusReauth'),
    ERROR: t('instagramSettings.statusError'),
    DISCONNECTED: t('instagramSettings.statusDisconnected'),
  }[status];
}

function formatVerificationDate(t: Translator, formatDate: ReturnType<typeof useI18n>['formatDate'], value: string | null): string {
  if (!value) return t('instagramSettings.neverChecked');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t('instagramSettings.neverChecked');
  return formatDate(date, { dateStyle: 'medium', timeStyle: 'short' });
}

function safeErrorCode(t: Translator, value: string): string {
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? t('instagramSettings.errorCode', { code: value }) : t('instagramSettings.connectionNeedsReview');
}

async function jsonOrNull(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isInstagramConnectionSummary(value: unknown): value is InstagramConnectionSummary {
  if (!isRecord(value) || typeof value.status !== 'string' || !CONNECTION_STATUSES.has(value.status as InstagramConnectionSummary['status'])) return false;
  return ['accountId', 'username', 'tokenExpiresAt', 'lastVerifiedAt', 'lastErrorCode', 'cleanupErrorCode'].every((key) => value[key] === null || typeof value[key] === 'string') &&
    typeof value.cleanupAbandonEligible === 'boolean' &&
    (value.cleanupStatus === 'NONE' || value.cleanupStatus === 'PENDING' || value.cleanupStatus === 'FAILED');
}
