'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { mutatingFetch } from '../auth/csrf-fetch';
import { useActivity } from './activity-provider';
import { LoadingButton } from './loading-button';
import { useToast } from './toast-provider';

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
  async function invite(event: FormEvent) {
    event.preventDefault(); setMessage(null); setPending(true);
    const response = await activity.run('Надсилаємо запрошення', () => mutatingFetch('/api/team/invitations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) }));
    setMessage(response.ok ? 'Запрошення надіслано' : 'Не вдалося надіслати запрошення');
    toast.show(response.ok ? { type: 'success', title: 'Запрошення надіслано' } : { type: 'error', title: 'Не вдалося надіслати запрошення' });
    setPending(false);
    if (response.ok) { setEmail(''); router.refresh(); }
  }
  async function mutate(path: string) { setPending(true); const response = await activity.run('Оновлюємо доступ команди', () => mutatingFetch(path, { method: 'POST' })); toast.show(response.ok ? { type: 'success', title: 'Доступ оновлено' } : { type: 'error', title: 'Не вдалося оновити доступ' }); setPending(false); if (response.ok) router.refresh(); }
  return <section className="management-content">
    <header className="settings-header"><h1>Команда</h1><p>Запрошуйте менеджерів і керуйте їхнім доступом.</p></header>
    <form className="invite-form" onSubmit={invite}><label>Email менеджера<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><LoadingButton className="primary-button" pending={pending} pendingLabel="Надсилаємо…" type="submit">Запросити</LoadingButton></form>
    {message && <p role="status">{message}</p>}
    <div className="management-card"><h2>Користувачі</h2>{initial.members.map((member) => <div className="management-row" key={member.id}><span><strong>{member.name}</strong><small>{member.email} · {member.role === 'OWNER' ? 'Власник' : 'Менеджер'}</small></span><span className={`access-badge status-${member.status.toLowerCase()}`}>{member.status === 'ACTIVE' ? 'Активний' : 'Заблокований'}</span>{member.role === 'MANAGER' && member.status === 'ACTIVE' && <button className="danger-button" onClick={() => window.confirm(`Заблокувати ${member.email}?`) && mutate(`/api/team/members/${member.id}/block`)} type="button">Заблокувати</button>}</div>)}</div>
    <div className="management-card"><h2>Очікують прийняття</h2>{initial.invitations.length === 0 ? <p className="orders-empty">Активних запрошень немає.</p> : initial.invitations.map((invite) => <div className="management-row" key={invite.id}><span><strong>{invite.email}</strong><small>Діє до {new Date(invite.expiresAt).toLocaleDateString('uk-UA')}</small></span><button className="secondary-button" onClick={() => mutate(`/api/team/invitations/${invite.id}/revoke`)} type="button">Відкликати</button></div>)}</div>
  </section>;
}
