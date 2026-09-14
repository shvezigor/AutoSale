'use client';

import type { FormEvent } from 'react';
import { useRef, useState } from 'react';
import type { ProfileResponse } from '../../../../packages/contracts/src/profile';
import { useRouter } from 'next/navigation';

import { mutatingFetch } from '../auth/csrf-fetch';
import { useActivity } from './activity-provider';
import { useConfirm } from './confirm-provider';
import { LoadingButton } from './loading-button';
import { useToast } from './toast-provider';

const AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const E164_PHONE = /^\+[1-9]\d{7,14}$/;

type PendingAction = 'details' | 'avatar' | 'avatar-delete' | 'password' | 'logout' | null;

export function ProfileEditor({ initial }: { initial: ProfileResponse }) {
  const [profile, setProfile] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState(initial.phone ?? '');
  const [phoneError, setPhoneError] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarError, setAvatarError] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [pending, setPending] = useState<PendingAction>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const activity = useActivity();
  const confirm = useConfirm();
  const toast = useToast();
  const router = useRouter();

  async function saveDetails(event: FormEvent) {
    event.preventDefault();
    const normalizedPhone = phone.replace(/[\s()-]/g, '');
    if (normalizedPhone && !E164_PHONE.test(normalizedPhone)) {
      setPhoneError('Вкажіть номер у міжнародному форматі, наприклад +380501112233.');
      return;
    }
    setPhoneError('');
    setPending('details');
    try {
      const response = await activity.run('Зберігаємо профіль', () => mutatingFetch('/api/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), phone: normalizedPhone || null, locale: profile.locale }),
      }));
      if (!response.ok) throw new Error('PROFILE_UPDATE_FAILED');
      const updated = await response.json() as ProfileResponse;
      setProfile(updated);
      setName(updated.name);
      setPhone(updated.phone ?? '');
      toast.show({ type: 'success', title: 'Профіль оновлено' });
      router.refresh();
    } catch {
      toast.show({ type: 'error', title: 'Не вдалося оновити профіль', message: 'Перевірте дані та спробуйте ще раз.' });
    } finally {
      setPending(null);
    }
  }

  function chooseAvatar(file: File | null) {
    setAvatarFile(null);
    setAvatarError('');
    if (!file) return;
    if (!AVATAR_TYPES.has(file.type)) {
      setAvatarError('Оберіть зображення JPEG, PNG або WebP.');
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError('Розмір фото має бути не більше 5 МБ.');
      return;
    }
    setAvatarFile(file);
  }

  async function uploadAvatar() {
    if (!avatarFile) return;
    const body = new FormData();
    body.append('file', avatarFile);
    setPending('avatar');
    try {
      const response = await activity.run('Завантажуємо фото профілю', () => mutatingFetch('/api/profile/avatar', { method: 'POST', body }));
      if (!response.ok) throw new Error('AVATAR_UPLOAD_FAILED');
      const updated = await response.json() as ProfileResponse;
      setProfile(updated);
      setAvatarFile(null);
      if (avatarInput.current) avatarInput.current.value = '';
      toast.show({ type: 'success', title: 'Фото профілю оновлено' });
      router.refresh();
    } catch {
      toast.show({ type: 'error', title: 'Не вдалося завантажити фото', message: 'Спробуйте інше зображення.' });
    } finally {
      setPending(null);
    }
  }

  async function deleteAvatar() {
    if (!await confirm({
      title: 'Видалити фото профілю?',
      description: 'Замість фото буде показано ініціал вашого імені.',
      confirmLabel: 'Так, видалити',
      tone: 'danger',
    })) return;
    setPending('avatar-delete');
    try {
      const response = await activity.run('Видаляємо фото профілю', () => mutatingFetch('/api/profile/avatar', { method: 'DELETE' }));
      if (!response.ok) throw new Error('AVATAR_DELETE_FAILED');
      const updated = await response.json() as ProfileResponse;
      setProfile(updated);
      toast.show({ type: 'success', title: 'Фото профілю видалено' });
      router.refresh();
    } catch {
      toast.show({ type: 'error', title: 'Не вдалося видалити фото' });
    } finally {
      setPending(null);
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmation) {
      setPasswordError('Новий пароль і підтвердження не збігаються.');
      return;
    }
    setPasswordError('');
    setPending('password');
    try {
      const response = await activity.run('Змінюємо пароль', () => mutatingFetch('/api/profile/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword, confirmation }),
      }));
      if (!response.ok) throw new Error('PASSWORD_CHANGE_FAILED');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      toast.show({ type: 'success', title: 'Пароль змінено' });
    } catch {
      toast.show({ type: 'error', title: 'Не вдалося змінити пароль', message: 'Перевірте поточний пароль і спробуйте ще раз.' });
    } finally {
      setPending(null);
    }
  }

  async function logout() {
    setPending('logout');
    try {
      const response = await activity.run('Виходимо з акаунта', () => mutatingFetch('/api/auth/logout', { method: 'POST' }));
      if (!response.ok) throw new Error('LOGOUT_FAILED');
      router.refresh();
    } catch {
      toast.show({ type: 'error', title: 'Не вдалося вийти з акаунта' });
    } finally {
      setPending(null);
    }
  }

  const displayInitial = profile.name.trim().charAt(0).toUpperCase() || 'U';

  return <div className="profile-sections">
    <section className="profile-card profile-personal-card" aria-labelledby="profile-personal-heading">
      <div className="profile-card-heading">
        <div><h2 id="profile-personal-heading">Особиста інформація</h2><p>Ці дані бачить ваша команда в AutoSale.</p></div>
      </div>
      <div className="profile-personal-grid">
        <div className="profile-avatar-panel">
          {profile.avatarUrl
            ? <img className="profile-avatar" src={profile.avatarUrl} alt={`Фото профілю ${profile.name}`} />
            : <span className="profile-avatar profile-avatar-fallback" aria-label={`Ініціал ${displayInitial}`}>{displayInitial}</span>}
          <div className="profile-avatar-controls">
            <label className="profile-file-field">Нове фото профілю<input ref={avatarInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => chooseAvatar(event.target.files?.[0] ?? null)} /></label>
            <small>JPEG, PNG або WebP, до 5 МБ.</small>
            {avatarError && <p className="profile-field-error" role="alert">{avatarError}</p>}
            <div className="profile-inline-actions">
              <LoadingButton className="primary-button" type="button" pending={pending === 'avatar'} pendingLabel="Завантажуємо…" disabled={!avatarFile || pending !== null} onClick={() => void uploadAvatar()}>Завантажити фото</LoadingButton>
              {profile.avatarUrl && <LoadingButton className="danger-button" type="button" pending={pending === 'avatar-delete'} pendingLabel="Видаляємо…" disabled={pending !== null} onClick={() => void deleteAvatar()}>Видалити фото</LoadingButton>}
            </div>
          </div>
        </div>
        <form className="profile-form" onSubmit={(event) => void saveDetails(event)}>
          <label>Ім’я<input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></label>
          <label>Телефон<input value={phone} inputMode="tel" placeholder="+380501112233" aria-invalid={Boolean(phoneError)} onChange={(event) => { setPhone(event.target.value); setPhoneError(''); }} /></label>
          {phoneError && <p className="profile-field-error" role="alert">{phoneError}</p>}
          <LoadingButton className="primary-button" pending={pending === 'details'} pendingLabel="Зберігаємо…" disabled={!name.trim() || pending !== null}>Зберегти зміни</LoadingButton>
        </form>
      </div>
    </section>

    <section className="profile-card" aria-labelledby="profile-security-heading">
      <div className="profile-card-heading"><div><h2 id="profile-security-heading">Безпека</h2><p>Керуйте способом входу до свого акаунта.</p></div></div>
      {profile.canChangePassword
        ? <form className="profile-form profile-password-form" onSubmit={(event) => void changePassword(event)}>
          <label>Поточний пароль<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
          <label>Новий пароль<input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
          <label>Повторіть новий пароль<input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
          {passwordError && <p className="profile-field-error" role="alert">{passwordError}</p>}
          <LoadingButton className="primary-button" pending={pending === 'password'} pendingLabel="Змінюємо…" disabled={!currentPassword || !newPassword || !confirmation || pending !== null}>Змінити пароль</LoadingButton>
        </form>
        : <div className="profile-signin-method"><span className="google-mark" aria-hidden="true">G</span><div><strong>Вхід через Google</strong><p>Пароль для цього акаунта не зберігається в AutoSale.</p></div></div>}
    </section>

    <section className="profile-card" aria-labelledby="profile-account-heading" aria-label="Акаунт">
      <div className="profile-card-heading"><div><h2 id="profile-account-heading">Акаунт</h2><p>Системна інформація та поточний доступ.</p></div></div>
      <dl className="profile-facts">
        <div><dt>Email</dt><dd>{profile.email}</dd></div>
        <div><dt>Роль</dt><dd>{membershipLabel(profile.membershipRole)}</dd></div>
        <div><dt>Створено</dt><dd><ProfileTime value={profile.createdAt} /></dd></div>
        <div><dt>Останній вхід</dt><dd>{profile.lastLoginAt ? <ProfileTime value={profile.lastLoginAt} /> : 'Ще не входили'}</dd></div>
      </dl>
      <div className="profile-account-actions">
        <LoadingButton className="secondary-button" type="button" pending={pending === 'logout'} pendingLabel="Виходимо…" disabled={pending !== null} onClick={() => void logout()}>Вийти з акаунта</LoadingButton>
      </div>
    </section>
  </div>;
}

function ProfileTime({ value }: { value: string }) {
  const formatted = new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'Europe/Kyiv',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
  return <time dateTime={value}>{formatted}</time>;
}

function membershipLabel(role: ProfileResponse['membershipRole']) {
  if (role === 'OWNER') return 'Власник';
  if (role === 'MANAGER') return 'Менеджер';
  return 'Без команди';
}
