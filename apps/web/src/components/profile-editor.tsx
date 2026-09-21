'use client';

import type { FormEvent } from 'react';
import { useRef, useState } from 'react';
import type { ProfileResponse } from '../../../../packages/contracts/src/profile';
import { useRouter } from 'next/navigation';

import { mutatingFetch } from '../auth/csrf-fetch';
import { useActivity } from './activity-provider';
import { useConfirm } from './confirm-provider';
import { LoadingButton } from './loading-button';
import { LocaleSwitcher } from './locale-switcher';
import { useToast } from './toast-provider';
import { useI18n } from '../i18n/i18n-provider';
import { localizeApiError } from '../i18n/error-message';
import { FieldError, FormField } from './form-field';
import { clearFieldError, focusFirstInvalid, nativeConstraintMessage, type FieldErrors } from './form-validation';

const AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const E164_PHONE = /^\+[1-9]\d{7,14}$/;

type PendingAction = 'details' | 'avatar' | 'avatar-delete' | 'password' | 'logout' | null;

export function ProfileEditor({ initial }: { initial: ProfileResponse }) {
  const [profile, setProfile] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState(initial.phone ?? '');
  const [detailErrors, setDetailErrors] = useState<FieldErrors<'name' | 'phone'>>({});
  const [avatarError, setAvatarError] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [passwordErrors, setPasswordErrors] = useState<FieldErrors<'currentPassword' | 'newPassword' | 'confirmation'>>({});
  const [pending, setPending] = useState<PendingAction>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const activity = useActivity();
  const confirm = useConfirm();
  const toast = useToast();
  const router = useRouter();
  const { formatDate, t } = useI18n();

  async function saveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedPhone = phone.replace(/[\s()-]/g, '');
    const errors: FieldErrors<'name' | 'phone'> = {};
    if (!name.trim()) errors.name = t('validation.required');
    if (normalizedPhone && !E164_PHONE.test(normalizedPhone)) errors.phone = t('profile.phoneInvalid');
    setDetailErrors(errors);
    if (Object.keys(errors).length > 0) {
      focusFirstInvalid(event.currentTarget, ['name', 'phone'].filter((field) => field in errors));
      return;
    }
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
    void uploadAvatar(file);
  }

  async function uploadAvatar(file: File) {
    const body = new FormData();
    body.append('avatar', file);
    setPending('avatar');
    try {
      const response = await activity.run(t('profile.uploading'), () => mutatingFetch('/api/profile/avatar', { method: 'POST', body }));
      if (!response.ok) throw await jsonOrNull(response);
      const updated = await response.json() as ProfileResponse;
      setProfile(updated);
      toast.show({ type: 'success', title: t('profile.photoUpdated') });
      router.refresh();
    } catch (reason) {
      toast.show({ type: 'error', title: t('profile.photoUpdateFailed'), message: localizeApiError(reason, t) });
    } finally {
      if (avatarInput.current) avatarInput.current.value = '';
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

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const errors: FieldErrors<'currentPassword' | 'newPassword' | 'confirmation'> = {};
    for (const field of ['currentPassword', 'newPassword', 'confirmation'] as const) {
      const control = form.elements.namedItem(field);
      if (control instanceof HTMLInputElement) {
        const message = nativeConstraintMessage(control, t);
        if (message) errors[field] = message;
      }
    }
    if (!errors.confirmation && newPassword !== confirmation) errors.confirmation = t('profile.passwordsMismatch');
    setPasswordErrors(errors);
    if (Object.keys(errors).length > 0) {
      focusFirstInvalid(form, ['currentPassword', 'newPassword', 'confirmation'].filter((field) => field in errors));
      return;
    }
    setPending('password');
    try {
      const response = await activity.run(t('profile.changing'), () => mutatingFetch('/api/profile/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword, confirmation }),
      }));
      if (!response.ok) throw await jsonOrNull(response);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      setPasswordErrors({});
      toast.show({ type: 'success', title: t('profile.passwordChanged') });
    } catch (reason) {
      toast.show({ type: 'error', title: t('profile.passwordChangeFailed'), message: localizeApiError(reason, t) });
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

  return <div className="profile-dashboard">
    <div className="profile-main-column">
      <section className="profile-card profile-personal-card" aria-labelledby="profile-personal-heading">
      <div className="profile-card-heading">
        <div><h2 id="profile-personal-heading">{t('profile.personalTitle')}</h2><p>{t('profile.personalDescription')}</p></div>
      </div>
      <div className="profile-personal-grid">
        <div className="profile-avatar-panel">
          <button
            className="profile-avatar-trigger"
            type="button"
            aria-label={pending === 'avatar' ? t('profile.uploadingPhoto') : t('profile.changePhoto')}
            disabled={pending !== null}
            onClick={() => avatarInput.current?.click()}
          >
            {profile.avatarUrl
              ? <img className="profile-avatar" src={profile.avatarUrl} alt="" />
              : <span className="profile-avatar profile-avatar-fallback" aria-hidden="true">{displayInitial}</span>}
            <span className="profile-avatar-overlay" aria-hidden="true">
              {pending === 'avatar'
                ? <span className="button-spinner" />
                : <svg viewBox="0 0 24 24" width="20" height="20"><path d="M9 5.5 10.2 4h3.6L15 5.5h2.5A2.5 2.5 0 0 1 20 8v8.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5V8a2.5 2.5 0 0 1 2.5-2.5H9Zm3 10.25A3.75 3.75 0 1 0 12 8.25a3.75 3.75 0 0 0 0 7.5Zm0-1.5a2.25 2.25 0 1 1 0-4.5 2.25 2.25 0 0 1 0 4.5Z" fill="currentColor" /></svg>}
            </span>
          </button>
          <input
            ref={avatarInput}
            id="profile-avatar"
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-label={t('profile.choosePhoto')}
            aria-invalid={avatarError ? 'true' : undefined}
            aria-describedby={avatarError ? 'profile-avatar-error' : undefined}
            tabIndex={-1}
            disabled={pending !== null}
            onChange={(event) => chooseAvatar(event.target.files?.[0] ?? null)}
          />
          <div className="profile-avatar-controls">
            <strong>{t('profile.changePhoto')}</strong>
            <span>{t('profile.photoClickHint')}</span>
            <small>{t('profile.photoHint')}</small>
            <FieldError id="profile-avatar-error" message={avatarError || null} />
            {profile.avatarUrl && <LoadingButton className="profile-avatar-remove" type="button" pending={pending === 'avatar-delete'} pendingLabel={t('profile.deleting')} disabled={pending !== null} onClick={() => void deleteAvatar()}>{t('profile.deletePhoto')}</LoadingButton>}
          </div>
        </div>
        <form className="profile-form" noValidate onSubmit={(event) => void saveDetails(event)}>
          <FormField id="profile-name" label={t('profile.name')} error={detailErrors.name} required>
            <input name="name" value={name} maxLength={120} onChange={(event) => { setName(event.target.value); setDetailErrors((current) => clearFieldError(current, 'name')); }} />
          </FormField>
          <FormField id="profile-phone" label={t('profile.phone')} error={detailErrors.phone}>
            <input name="phone" value={phone} inputMode="tel" placeholder="+380501112233" onChange={(event) => { setPhone(event.target.value); setDetailErrors((current) => clearFieldError(current, 'phone')); }} />
          </FormField>
          <LoadingButton className="primary-button" pending={pending === 'details'} pendingLabel={t('profile.saving')} disabled={pending !== null}>{t('profile.saveChanges')}</LoadingButton>
        </form>
      </div>
      </section>

      <section className="profile-card" aria-labelledby="profile-security-heading">
      <div className="profile-card-heading"><div><h2 id="profile-security-heading">{t('profile.securityTitle')}</h2><p>{t('profile.securityDescription')}</p></div></div>
      {profile.canChangePassword
        ? <form className="profile-form profile-password-form" noValidate onSubmit={(event) => void changePassword(event)}>
          <FormField id="profile-current-password" label={t('profile.currentPassword')} error={passwordErrors.currentPassword} required>
            <input name="currentPassword" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => { setCurrentPassword(event.target.value); setPasswordErrors((current) => clearFieldError(current, 'currentPassword')); }} />
          </FormField>
          <FormField id="profile-new-password" label={t('profile.newPassword')} error={passwordErrors.newPassword} required>
            <input name="newPassword" type="password" autoComplete="new-password" minLength={12} value={newPassword} onChange={(event) => { setNewPassword(event.target.value); setPasswordErrors((current) => clearFieldError(current, 'newPassword')); }} />
          </FormField>
          <FormField id="profile-confirmation" label={t('profile.repeatPassword')} error={passwordErrors.confirmation} required>
            <input name="confirmation" type="password" autoComplete="new-password" minLength={12} value={confirmation} onChange={(event) => { setConfirmation(event.target.value); setPasswordErrors((current) => clearFieldError(current, 'confirmation')); }} />
          </FormField>
          <LoadingButton className="primary-button" pending={pending === 'password'} pendingLabel={t('profile.changing')} disabled={pending !== null}>{t('profile.changePassword')}</LoadingButton>
        </form>
        : <div className="profile-signin-method"><span className="google-mark" aria-hidden="true">G</span><div><strong>{t('profile.googleSignIn')}</strong><p>{t('profile.googlePasswordDescription')}</p></div></div>}
      </section>
    </div>

    <aside className="profile-side-column" aria-label={t('profile.preferencesTitle')}>
      <section className="profile-card profile-language-card" aria-labelledby="profile-language-heading">
        <div><h2 id="profile-language-heading">{t('language.label')}</h2><p>{t('profile.languageDescription')}</p></div>
        <LocaleSwitcher variant="profile" />
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
    </aside>
  </div>;
}

async function jsonOrNull(response: Response): Promise<unknown> {
  try { return await response.json(); }
  catch { return null; }
}
