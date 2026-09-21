'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { mutatingFetch } from '../auth/csrf-fetch';
import { useActivity } from './activity-provider';
import { LoadingButton } from './loading-button';
import { useToast } from './toast-provider';
import { useI18n } from '../i18n/i18n-provider';
import { FormField } from './form-field';
import { focusFirstInvalid, nativeConstraintMessage } from './form-validation';

export interface TeamData {
  members: Array<{ id: string; email: string; name: string; role: 'OWNER' | 'MANAGER'; status: string; createdAt: string }>;
  invitations: Array<{ id: string; email: string; role: string; expiresAt: string; createdAt: string }>;
}

export function TeamManagement({ initial }: { initial: TeamData }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [emailError, setEmailError] = useState('');
  const [pending, setPending] = useState(false);
  const activity = useActivity();
  const toast = useToast();
  const { t, formatDate } = useI18n();
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const control = event.currentTarget.elements.namedItem('email');
    const error = control instanceof HTMLInputElement ? nativeConstraintMessage(control, t) : t('validation.invalid');
    setEmailError(error ?? '');
    if (error) {
      focusFirstInvalid(event.currentTarget, ['email']);
      return;
    }
    setPending(true);
    const response = await activity.run(t('team.invitationActivity'), () => mutatingFetch('/api/team/invitations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) }));
    setMessage(response.ok ? t('team.invitationSent') : t('team.invitationFailed'));
    toast.show(response.ok ? { type: 'success', title: t('team.invitationSent') } : { type: 'error', title: t('team.invitationFailed') });
    setPending(false);
    if (response.ok) { setEmail(''); router.refresh(); }
  }
  async function mutate(path: string) { setPending(true); const response = await activity.run(t('team.accessActivity'), () => mutatingFetch(path, { method: 'POST' })); toast.show(response.ok ? { type: 'success', title: t('team.accessUpdated') } : { type: 'error', title: t('team.accessFailed') }); setPending(false); if (response.ok) router.refresh(); }
  return <section className="management-content">
    <header className="settings-header management-header"><h1>{t('team.title')}</h1><p>{t('team.description')}</p></header>
    <div className="team-grid">
      <section className="team-invite-card">
        <h2>{t('team.inviteTitle')}</h2>
        <form className="invite-form" noValidate onSubmit={invite}>
          <FormField id="team-invite-email" label={t('team.managerEmail')} error={emailError} required>
            <input name="email" required type="email" value={email} onChange={(event) => { setEmail(event.target.value); setEmailError(''); }} />
          </FormField>
          <LoadingButton className="primary-button" pending={pending} pendingLabel={t('team.inviting')} type="submit">{t('team.invite')}</LoadingButton>
        </form>
        {message && <p role="status">{message}</p>}
      </section>
      <section className="management-card team-members-card"><h2>{t('team.users')}</h2>{initial.members.map((member) => <div className="management-row" key={member.id}><span className="team-avatar" aria-hidden="true">{initials(member.name)}</span><span><strong>{member.name}</strong><small>{member.email} · {member.role === 'OWNER' ? t('team.owner') : t('team.manager')}</small></span><span className={`access-badge status-${member.status.toLowerCase()}`}>{member.status === 'ACTIVE' ? t('team.active') : t('team.blocked')}</span>{member.role === 'MANAGER' && member.status === 'ACTIVE' && <button className="danger-button" onClick={() => window.confirm(t('team.blockConfirm', { email: member.email })) && mutate(`/api/team/members/${member.id}/block`)} type="button">{t('team.block')}</button>}</div>)}
        <h3>{t('team.pending')}</h3>{initial.invitations.length === 0 ? <p className="team-empty">{t('team.noInvitations')}</p> : initial.invitations.map((invitation) => <div className="management-row" key={invitation.id}><span className="team-avatar" aria-hidden="true">{initials(invitation.email)}</span><span><strong>{invitation.email}</strong><small>{t('team.validUntil', { date: formatDate(invitation.expiresAt) })}</small></span><button className="secondary-button" onClick={() => mutate(`/api/team/invitations/${invitation.id}/revoke`)} type="button">{t('team.revoke')}</button></div>)}
      </section>
    </div>
  </section>;
}

function initials(value: string) { return value.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join(''); }
