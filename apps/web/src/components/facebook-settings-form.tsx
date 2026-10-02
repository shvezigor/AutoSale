'use client';

import type {
  FacebookConnectionSummary,
  FacebookPageCandidate,
} from '../../../../packages/contracts/src/facebook';
import { type FormEvent, useRef, useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';
import { useI18n } from '../i18n/i18n-provider';
import { clearFieldError, focusFirstInvalid, type FieldErrors } from './form-validation';
import { FormField } from './form-field';
import { LoadingButton } from './loading-button';

type MembershipRole = 'OWNER' | 'MANAGER' | null;
type Selection = { attemptId: string; pages: FacebookPageCandidate[] } | null;
type PendingAction = 'connect' | 'select' | 'disconnect' | 'cleanup' | null;

export function FacebookSettingsForm({
  initial,
  membershipRole,
  selection = null,
  embedded = false,
  onConnectionChange,
}: {
  initial: FacebookConnectionSummary;
  membershipRole: MembershipRole;
  selection?: Selection;
  embedded?: boolean;
  onConnectionChange?: (connection: FacebookConnectionSummary) => void;
}) {
  const { formatDate, t } = useI18n();
  const [connection, setConnection] = useState(initial);
  const [selectedPageId, setSelectedPageId] = useState('');
  const [errors, setErrors] = useState<FieldErrors<'pageId'>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const selectionFormRef = useRef<HTMLFormElement>(null);
  const isOwner = membershipRole === 'OWNER';

  function updateConnection(next: FacebookConnectionSummary) {
    setConnection(next);
    onConnectionChange?.(next);
  }

  async function connect() {
    setPending('connect');
    setFormError(null);
    try {
      const response = await mutatingFetch('/api/integrations/facebook/authorize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ returnPath: '/settings?tab=social' }),
      });
      const payload = await jsonOrNull(response);
      const authorizationUrl = isRecord(payload) ? payload.authorizationUrl : null;
      if (!response.ok || typeof authorizationUrl !== 'string' || !isTrustedFacebookAuthorizationUrl(authorizationUrl)) {
        throw new Error('FACEBOOK_AUTHORIZE_FAILED');
      }
      window.location.href = authorizationUrl;
    } catch {
      setFormError(t('facebookSettings.connectFailed'));
    } finally {
      setPending(null);
    }
  }

  async function selectPage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selection) return;
    if (!selectedPageId) {
      setErrors({ pageId: t('facebookSettings.pageRequired') });
      requestAnimationFrame(() => selectionFormRef.current && focusFirstInvalid(selectionFormRef.current, ['pageId']));
      return;
    }
    setPending('select');
    setFormError(null);
    try {
      const response = await mutatingFetch('/api/integrations/facebook/selection', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ attemptId: selection.attemptId, pageId: selectedPageId }),
      });
      const payload = await jsonOrNull(response);
      if (!response.ok || !isFacebookSummary(payload)) throw new Error('FACEBOOK_SELECTION_FAILED');
      updateConnection(payload);
      window.history.replaceState(null, '', '/settings?tab=social');
    } catch {
      setFormError(t('facebookSettings.selectionFailed'));
    } finally {
      setPending(null);
    }
  }

  async function disconnect() {
    setPending('disconnect');
    setFormError(null);
    try {
      const response = await mutatingFetch('/api/integrations/facebook', { method: 'DELETE' });
      const payload = await jsonOrNull(response);
      if (!response.ok || !isFacebookSummary(payload)) throw new Error('FACEBOOK_DISCONNECT_FAILED');
      updateConnection(payload);
    } catch {
      setFormError(t('facebookSettings.disconnectFailed'));
    } finally {
      setPending(null);
    }
  }

  async function retryCleanup() {
    setPending('cleanup');
    setFormError(null);
    try {
      const response = await mutatingFetch('/api/integrations/facebook/cleanup/retry', { method: 'POST' });
      const payload = await jsonOrNull(response);
      if (!response.ok || !isFacebookSummary(payload)) throw new Error('FACEBOOK_CLEANUP_FAILED');
      updateConnection(payload);
    } catch {
      setFormError(t('facebookSettings.cleanupFailed'));
    } finally {
      setPending(null);
    }
  }

  const status = facebookStatusLabel(connection.status, t);
  return <section className={`settings-card facebook-connection-card ${embedded ? 'is-embedded' : ''}`} aria-busy={pending !== null || undefined} aria-label={embedded ? 'Facebook' : undefined}>
    {!embedded && <div className="settings-card-heading"><div><h2>Facebook</h2><p>{t('facebookSettings.description')}</p></div><span className={`connection-status status-${connection.status.toLowerCase()}`}>{status}</span></div>}
    {embedded && <div className="delivery-panel-section-heading"><span>{t('facebookSettings.connectionSection')}</span><p>{t('facebookSettings.connectionSectionDescription')}</p></div>}

    <dl className="instagram-connection-details">
      <div><dt>{t('facebookSettings.page')}</dt><dd>{connection.pageName ?? t('facebookSettings.notConnected')}</dd></div>
      <div><dt>{t('facebookSettings.lastCheck')}</dt><dd>{connection.lastVerifiedAt ? formatDate(connection.lastVerifiedAt) : t('facebookSettings.neverChecked')}</dd></div>
      <div><dt>{t('facebookSettings.state')}</dt><dd>{status}</dd></div>
    </dl>

    {membershipRole === 'MANAGER' && <p className="sheets-hint">{t('facebookSettings.managerReadonly')}</p>}

    {isOwner && selection && selection.pages.length > 0 && connection.status !== 'ACTIVE' ? <form className="facebook-page-selection" noValidate onSubmit={(event) => void selectPage(event)} ref={selectionFormRef}>
      <FormField id="facebook-page" label={t('facebookSettings.pageLabel')} error={errors.pageId} required>
        <select
          data-field="pageId"
          name="pageId"
          onChange={(event) => {
            setSelectedPageId(event.target.value);
            setErrors((current) => clearFieldError(current, 'pageId'));
          }}
          value={selectedPageId}
        >
          <option value="">{t('facebookSettings.choosePage')}</option>
          {selection.pages.map((page) => <option key={page.pageId} value={page.pageId}>{page.pageName}</option>)}
        </select>
      </FormField>
      <LoadingButton className="primary-button" pending={pending === 'select'} pendingLabel={t('facebookSettings.connecting')} type="submit">{t('facebookSettings.connectPage')}</LoadingButton>
    </form> : null}

    {isOwner && <div className="settings-actions">
      {connection.cleanupStatus === 'PENDING' || connection.cleanupStatus === 'FAILED' ? (
        <LoadingButton className="secondary-button" onClick={() => void retryCleanup()} pending={pending === 'cleanup'} type="button">{t('facebookSettings.retryCleanup')}</LoadingButton>
      ) : null}
      {connection.status !== 'ACTIVE' && !selection ? (
        <LoadingButton className="primary-button" onClick={() => void connect()} pending={pending === 'connect'} pendingLabel={t('facebookSettings.connecting')} type="button">{t('facebookSettings.connect')}</LoadingButton>
      ) : null}
      {connection.status === 'ACTIVE' ? (
        <LoadingButton className="danger-button" onClick={() => void disconnect()} pending={pending === 'disconnect'} type="button">{t('facebookSettings.disconnect')}</LoadingButton>
      ) : null}
    </div>}
    {formError ? <p className="save-error" role="alert">{formError}</p> : null}
  </section>;
}

function facebookStatusLabel(status: FacebookConnectionSummary['status'], t: ReturnType<typeof useI18n>['t']): string {
  return {
    NOT_CONNECTED: t('facebookSettings.statusNotConnected'),
    ACTIVE: t('facebookSettings.statusActive'),
    REAUTH_REQUIRED: t('facebookSettings.statusReauth'),
    ERROR: t('facebookSettings.statusError'),
    DISCONNECTED: t('facebookSettings.statusDisconnected'),
  }[status];
}

function isTrustedFacebookAuthorizationUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'www.facebook.com';
  } catch {
    return false;
  }
}

function isFacebookSummary(value: unknown): value is FacebookConnectionSummary {
  if (!isRecord(value)) return false;
  return typeof value.status === 'string' && 'pageId' in value && 'cleanupStatus' in value;
}

async function jsonOrNull(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
