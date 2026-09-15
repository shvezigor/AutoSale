'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { mutatingFetch } from '../auth/csrf-fetch';
import { useActivity } from './activity-provider';
import { LoadingButton } from './loading-button';
import { useToast } from './toast-provider';
import { useI18n } from '../i18n/i18n-provider';

export interface TeamData {
  members: Array<{ id: string; email: string; name: string; role: 'OWNER' | 'MANAGER'; status: string; createdAt: string }>;
  invitations: Array<{ id: string; email: string; role: string; expiresAt: string; createdAt: string }>;
}

export function TeamManagement({ initial }: { initial: TeamData }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const activity = useActivity();
  const toast = useToast();
  const { t, formatDate } = useI18n();
  async function invite(event: FormEvent) {
    event.preventDefault(); setMessage(null); setPending(true);
    const response = await activity.run(t('team.invitationActivity'), () => mutatingFetch('/api/team/invitations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) }));
    setMessage(response.ok ? t('team.invitationSent') : t('team.invitationFailed'));
    toast.show(response.ok ? { type: 'success', title: t('team.invitationSent') } : { type: 'error', title: t('team.invitationFailed') });
    setPending(false);
    if (response.ok) { setEmail(''); router.refresh(); }
  }
  async function mutate(path: string) { setPending(true); const response = await activity.run(t('team.accessActivity'), () => mutatingFetch(path, { method: 'POST' })); toast.show(response.ok ? { type: 'success', title: t('team.accessUpdated') } : { type: 'error', title: t('team.accessFailed') }); setPending(false); if (response.ok) router.refresh(); }
  return <section className="management-content">
    <header className="settings-header"><h1>{t('team.title')}</h1><p>{t('team.description')}</p></header>
    <form className="invite-form" onSubmit={invite}><label>{t('team.managerEmail')}<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><LoadingButton className="primary-button" pending={pending} pendingLabel={t('team.inviting')} type="submit">{t('team.invite')}</LoadingButton></form>
    {message && <p role="status">{message}</p>}
    <div className="management-card"><h2>{t('team.users')}</h2>{initial.members.map((member) => <div className="management-row" key={member.id}><span><strong>{member.name}</strong><small>{member.email} · {member.role === 'OWNER' ? t('team.owner') : t('team.manager')}</small></span><span className={`access-badge status-${member.status.toLowerCase()}`}>{member.status === 'ACTIVE' ? t('team.active') : t('team.blocked')}</span>{member.role === 'MANAGER' && member.status === 'ACTIVE' && <button className="danger-button" onClick={() => window.confirm(t('team.blockConfirm', { email: member.email })) && mutate(`/api/team/members/${member.id}/block`)} type="button">{t('team.block')}</button>}</div>)}</div>
    <div className="management-card"><h2>{t('team.pending')}</h2>{initial.invitations.length === 0 ? <p className="orders-empty">{t('team.noInvitations')}</p> : initial.invitations.map((invite) => <div className="management-row" key={invite.id}><span><strong>{invite.email}</strong><small>{t('team.validUntil', { date: formatDate(invite.expiresAt) })}</small></span><button className="secondary-button" onClick={() => mutate(`/api/team/invitations/${invite.id}/revoke`)} type="button">{t('team.revoke')}</button></div>)}</div>
  </section>;
}
