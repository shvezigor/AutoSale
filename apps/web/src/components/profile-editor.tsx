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
import { useI18n } from '../i18n/i18n-provider';

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
  const { formatDate, t } = useI18n();

  async function saveDetails(event: FormEvent) {
    event.preventDefault();
    const normalizedPhone = phone.replace(/[\s()-]/g, '');
    if (normalizedPhone && !E164_PHONE.test(normalizedPhone)) {
      setPhoneError(t('profile.phoneInvalid'));
      return;
    }
    setPhoneError('');
    setPending('details');
    try {
      const response = await activity.run(t('profile.saving'), () => mutatingFetch('/api/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), phone: normalizedPhone || null, locale: profile.locale }),
      }));
      if (!response.ok) throw new Error('PROFILE_UPDATE_FAILED');
      const updated = await response.json() as ProfileResponse;
      setProfile(updated);
      setName(updated.name);
      setPhone(updated.phone ?? '');
      toast.show({ type: 'success', title: t('profile.updated') });
      router.refresh();
    } catch {
      toast.show({ type: 'error', title: t('profile.updateFailed'), message: t('profile.checkAndRetry') });
    } finally {
      setPending(null);
    }
  }

  function chooseAvatar(file: File | null) {
    setAvatarFile(null);
    setAvatarError('');
    if (!file) return;
    if (!AVATAR_TYPES.has(file.type)) {
      setAvatarError(t('profile.photoTypeInvalid'));
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError(t('profile.photoSizeInvalid'));
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
      const response = await activity.run(t('profile.uploading'), () => mutatingFetch('/api/profile/avatar', { method: 'POST', body }));
      if (!response.ok) throw new Error('AVATAR_UPLOAD_FAILED');
      const updated = await response.json() as ProfileResponse;
      setProfile(updated);
      setAvatarFile(null);
      if (avatarInput.current) avatarInput.current.value = '';
      toast.show({ type: 'success', title: t('profile.photoUpdated') });
      router.refresh();
    } catch {
      toast.show({ type: 'error', title: t('profile.photoUpdateFailed'), message: t('profile.useAnotherPhoto') });
    } finally {
      setPending(null);
    }
  }

  async function deleteAvatar() {
    if (!await confirm({
      title: t('profile.deleteConfirmTitle'),
      description: t('profile.deleteConfirmDescription'),
      confirmLabel: t('profile.deleteConfirm'),
      tone: 'danger',
    })) return;
    setPending('avatar-delete');
    try {
      const response = await activity.run(t('profile.deleting'), () => mutatingFetch('/api/profile/avatar', { method: 'DELETE' }));
      if (!response.ok) throw new Error('AVATAR_DELETE_FAILED');
      const updated = await response.json() as ProfileResponse;
      setProfile(updated);
      toast.show({ type: 'success', title: t('profile.photoDeleted') });
      router.refresh();
    } catch {
      toast.show({ type: 'error', title: t('profile.photoDeleteFailed') });
    } finally {
      setPending(null);
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmation) {
      setPasswordError(t('profile.passwordsMismatch'));
      return;
    }
    setPasswordError('');
    setPending('password');
    try {
      const response = await activity.run(t('profile.changing'), () => mutatingFetch('/api/profile/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword, confirmation }),
      }));
      if (!response.ok) throw new Error('PASSWORD_CHANGE_FAILED');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      toast.show({ type: 'success', title: t('profile.passwordChanged') });
    } catch {
      toast.show({ type: 'error', title: t('profile.passwordChangeFailed'), message: t('profile.passwordRetry') });
    } finally {
      setPending(null);
    }
  }

  async function logout() {
    setPending('logout');
    try {
      const response = await activity.run(t('header.signingOut'), () => mutatingFetch('/api/auth/logout', { method: 'POST' }));
      if (!response.ok) throw new Error('LOGOUT_FAILED');
      router.refresh();
    } catch {
      toast.show({ type: 'error', title: t('profile.signOutFailed') });
    } finally {
      setPending(null);
    }
  }

  const displayInitial = profile.name.trim().charAt(0).toUpperCase() || 'U';

  return <div className="profile-sections">
    <section className="profile-card profile-personal-card" aria-labelledby="profile-personal-heading">
      <div className="profile-card-heading">
        <div><h2 id="profile-personal-heading">{t('profile.personalTitle')}</h2><p>{t('profile.personalDescription')}</p></div>
      </div>
      <div className="profile-personal-grid">
        <div className="profile-avatar-panel">
          {profile.avatarUrl
            ? <img className="profile-avatar" src={profile.avatarUrl} alt={t('header.profilePhoto', { name: profile.name })} />
            : <span className="profile-avatar profile-avatar-fallback" aria-label={t('header.initial', { initial: displayInitial })}>{displayInitial}</span>}
          <div className="profile-avatar-controls">
            <label className="profile-file-field">{t('profile.newPhoto')}<input ref={avatarInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => chooseAvatar(event.target.files?.[0] ?? null)} /></label>
            <small>{t('profile.photoHint')}</small>
            {avatarError && <p className="profile-field-error" role="alert">{avatarError}</p>}
            <div className="profile-inline-actions">
              <LoadingButton className="primary-button" type="button" pending={pending === 'avatar'} pendingLabel={t('profile.uploading')} disabled={!avatarFile || pending !== null} onClick={() => void uploadAvatar()}>{t('profile.uploadPhoto')}</LoadingButton>
              {profile.avatarUrl && <LoadingButton className="danger-button" type="button" pending={pending === 'avatar-delete'} pendingLabel={t('profile.deleting')} disabled={pending !== null} onClick={() => void deleteAvatar()}>{t('profile.deletePhoto')}</LoadingButton>}
            </div>
          </div>
        </div>
        <form className="profile-form" onSubmit={(event) => void saveDetails(event)}>
          <label>{t('profile.name')}<input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></label>
          <label>{t('profile.phone')}<input value={phone} inputMode="tel" placeholder="+380501112233" aria-invalid={Boolean(phoneError)} onChange={(event) => { setPhone(event.target.value); setPhoneError(''); }} /></label>
          {phoneError && <p className="profile-field-error" role="alert">{phoneError}</p>}
          <LoadingButton className="primary-button" pending={pending === 'details'} pendingLabel={t('profile.saving')} disabled={!name.trim() || pending !== null}>{t('profile.saveChanges')}</LoadingButton>
        </form>
      </div>
    </section>

    <section className="profile-card" aria-labelledby="profile-security-heading">
      <div className="profile-card-heading"><div><h2 id="profile-security-heading">{t('profile.securityTitle')}</h2><p>{t('profile.securityDescription')}</p></div></div>
      {profile.canChangePassword
        ? <form className="profile-form profile-password-form" onSubmit={(event) => void changePassword(event)}>
          <label>{t('profile.currentPassword')}<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
          <label>{t('profile.newPassword')}<input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
          <label>{t('profile.repeatPassword')}<input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
          {passwordError && <p className="profile-field-error" role="alert">{passwordError}</p>}
          <LoadingButton className="primary-button" pending={pending === 'password'} pendingLabel={t('profile.changing')} disabled={!currentPassword || !newPassword || !confirmation || pending !== null}>{t('profile.changePassword')}</LoadingButton>
        </form>
        : <div className="profile-signin-method"><span className="google-mark" aria-hidden="true">G</span><div><strong>{t('profile.googleSignIn')}</strong><p>{t('profile.googlePasswordDescription')}</p></div></div>}
    </section>

    <section className="profile-card" aria-labelledby="profile-account-heading" aria-label={t('profile.accountTitle')}>
      <div className="profile-card-heading"><div><h2 id="profile-account-heading">{t('profile.accountTitle')}</h2><p>{t('profile.accountDescription')}</p></div></div>
      <dl className="profile-facts">
        <div><dt>Email</dt><dd>{profile.email}</dd></div>
        <div><dt>{t('profile.role')}</dt><dd>{profile.membershipRole === 'OWNER' ? t('header.owner') : profile.membershipRole === 'MANAGER' ? t('header.manager') : t('profile.noTeam')}</dd></div>
        <div><dt>{t('profile.created')}</dt><dd><time dateTime={profile.createdAt}>{formatDate(profile.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}</time></dd></div>
        <div><dt>{t('profile.lastLogin')}</dt><dd>{profile.lastLoginAt ? <time dateTime={profile.lastLoginAt}>{formatDate(profile.lastLoginAt, { dateStyle: 'medium', timeStyle: 'short' })}</time> : t('profile.neverLoggedIn')}</dd></div>
      </dl>
      <div className="profile-account-actions">
        <LoadingButton className="secondary-button" type="button" pending={pending === 'logout'} pendingLabel={t('header.signingOut')} disabled={pending !== null} onClick={() => void logout()}>{t('profile.signOutAccount')}</LoadingButton>
      </div>
    </section>
  </div>;
}
