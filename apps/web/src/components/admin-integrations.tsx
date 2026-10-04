'use client';

import { adminIntegrationControlSchema, type AdminIntegrationControl } from '../../../../packages/contracts/src/auth';
import { useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';
import { useI18n } from '../i18n/i18n-provider';
import { getAdminCopy } from './admin-copy';
import { useConfirm } from './confirm-provider';
import { LoadingButton } from './loading-button';

export function AdminIntegrations({ initialControls }: { initialControls: AdminIntegrationControl[] }) {
  const { locale } = useI18n();
  const text = getAdminCopy(locale).integrations;
  const confirm = useConfirm();
  const [controls, setControls] = useState(initialControls);
  const [pendingKey, setPendingKey] = useState<AdminIntegrationControl['key'] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function update(control: AdminIntegrationControl) {
    if (pendingKey || !control.deploymentAvailable) return;
    const enabled = !control.runtimeEnabled;
    if (!enabled) {
      const accepted = await confirm({
        title: text.confirmTitle.replace('{channel}', text.channels[control.key].name),
        description: text.confirmDescription,
        confirmLabel: text.confirm,
        tone: 'danger',
      });
      if (!accepted) return;
    }

    setError(null);
    setPendingKey(control.key);
    try {
      const response = await mutatingFetch(`/api/admin/integrations/${control.key}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const parsed = response.ok ? adminIntegrationControlSchema.safeParse(await response.json()) : null;
      if (!parsed?.success) throw new Error('ADMIN_INTEGRATION_UPDATE_FAILED');
      setControls((current) => current.map((row) => row.key === parsed.data.key ? parsed.data : row));
    } catch {
      setError(text.mutationFailed);
    } finally {
      setPendingKey(null);
    }
  }

  return <div className="admin-page">
    <header className="admin-page-heading"><div><span className="admin-eyebrow">{text.eyebrow}</span><h1>{text.title}</h1><p>{text.description}</p></div></header>
    {error && <p className="admin-form-error admin-integrations-error" role="alert" aria-live="polite">{error}</p>}
    <section className="admin-integration-grid" aria-label={text.title}>{controls.map((control) => {
      const channel = text.channels[control.key];
      const unavailable = control.state === 'DEPLOYMENT_UNAVAILABLE';
      const pending = pendingKey === control.key;
      return <article className={`admin-integration-card state-${control.state.toLowerCase()}`} key={control.key}>
        <div className="admin-integration-mark" aria-hidden="true">{control.key === 'FACEBOOK_MESSENGER' ? 'f' : '♪'}</div>
        <div className="admin-integration-copy"><h2>{channel.name}</h2><p>{channel.description}</p>{unavailable && <small>{text.unavailableHint}</small>}</div>
        <div className="admin-integration-control"><span className={`admin-access-status${control.state === 'ACTIVE' ? '' : control.state === 'ADMIN_DISABLED' ? ' status-attention' : ' status-blocked'}`}>{text.states[control.state]}</span>
          {!unavailable && <LoadingButton className={control.runtimeEnabled ? 'danger-button' : 'primary-button'} pending={pending} pendingLabel={control.runtimeEnabled ? text.disabling : text.enabling} disabled={pendingKey !== null} type="button" onClick={() => void update(control)}>{control.runtimeEnabled ? text.disable : text.enable}</LoadingButton>}
        </div>
      </article>;
    })}</section>
  </div>;
}
