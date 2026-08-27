'use client';

import { FormEvent, useState } from 'react';
import { mutatingFetch } from '../auth/csrf-fetch';

export interface InstagramSettings { externalAccountId: string | null; displayName: string | null; status: 'NOT_CONFIGURED' | 'ACTIVE' | 'BLOCKED'; updatedAt: string | null }

export function InstagramSettingsForm({ initial }: { initial: InstagramSettings }) {
  const [accountId, setAccountId] = useState(initial.externalAccountId ?? '');
  const [displayName, setDisplayName] = useState(initial.displayName ?? '');
  const [state, setState] = useState<'idle' | 'saved' | 'error'>('idle');
  async function submit(event: FormEvent) {
    event.preventDefault(); setState('idle');
    const response = await mutatingFetch('/api/settings/instagram', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ externalAccountId: accountId, displayName: displayName || null }) });
    setState(response.ok ? 'saved' : 'error');
  }
  return <form className="settings-card sheets-card" onSubmit={submit}><div className="settings-card-heading"><div><h2>Instagram</h2><p>Вкажіть ID професійного Instagram-акаунта, події якого належать цій організації.</p></div><span className={`connection-status status-${initial.status.toLowerCase()}`}>{initial.status === 'ACTIVE' ? 'Активне' : 'Не налаштовано'}</span></div><div className="sheets-fields"><label>Instagram Account ID<input inputMode="numeric" pattern="[0-9]{5,64}" required value={accountId} onChange={(event) => setAccountId(event.target.value)} /></label><label>Назва акаунта<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label></div><p className="sheets-hint">Це числовий ID Professional Account, не username.</p><div className="settings-actions"><button type="submit">Зберегти Instagram</button>{state === 'saved' && <span className="save-success">Instagram підключено</span>}{state === 'error' && <span className="save-error">Не вдалося зберегти</span>}</div></form>;
}
