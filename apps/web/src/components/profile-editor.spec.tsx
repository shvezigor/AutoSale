import type { ProfileResponse } from '../../../../packages/contracts/src/profile';
import { cleanup, fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mutatingFetch, refresh } = vi.hoisted(() => ({ mutatingFetch: vi.fn(), refresh: vi.fn() }));
vi.mock('../auth/csrf-fetch', () => ({ mutatingFetch }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { ActivityProvider } from './activity-provider';
import { ConfirmProvider } from './confirm-provider';
import { ProfileEditor } from './profile-editor';
import { ToastProvider } from './toast-provider';
import { I18nProvider } from '../i18n/i18n-provider';

const baseProfile: ProfileResponse = {
  userId: '11111111-1111-4111-8111-111111111111',
  email: 'ihor@example.com',
  name: 'Ігор Швець',
  phone: '+380501112233',
  locale: 'uk',
  avatarUrl: '/api/media/profile/avatar?v=abc',
  membershipRole: 'OWNER',
  signInMethods: ['PASSWORD'],
  canChangePassword: true,
  createdAt: '2026-09-14T10:00:00.000Z',
  lastLoginAt: '2026-09-14T11:00:00.000Z',
};

function render(initial: ProfileResponse = baseProfile, locale: 'uk' | 'en' = 'uk') {
  return rtlRender(
    <I18nProvider locale={locale} authenticated><ToastProvider><ActivityProvider><ConfirmProvider>
      <ProfileEditor initial={initial} />
    </ConfirmProvider></ActivityProvider></ToastProvider></I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  mutatingFetch.mockReset();
  refresh.mockReset();
});

describe('ProfileEditor', () => {
  it('saves editable personal details, normalizes a blank phone, and refreshes identity', async () => {
    mutatingFetch.mockResolvedValue(new Response(JSON.stringify({ ...baseProfile, name: 'Ігор Новий', phone: null }), { status: 200 }));
    render();
    fireEvent.change(screen.getByLabelText('Ім’я'), { target: { value: 'Ігор Новий' } });
    fireEvent.change(screen.getByLabelText('Телефон'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти зміни' }));

    await waitFor(() => expect(mutatingFetch).toHaveBeenCalledWith('/api/profile', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ name: 'Ігор Новий', phone: null, locale: 'uk' }),
    })));
    expect(await screen.findByText('Профіль оновлено')).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('keeps an invalid phone editable and does not send it', () => {
    render();
    fireEvent.change(screen.getByLabelText('Телефон'), { target: { value: '050 12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти зміни' }));

    expect(screen.getByLabelText('Телефон')).toHaveValue('050 12');
    expect(screen.getByRole('alert')).toHaveTextContent('Вкажіть номер у міжнародному форматі');
    expect(mutatingFetch).not.toHaveBeenCalled();
  });

  it('uploads one valid avatar file with stable progress', async () => {
    let resolveRequest!: (value: Response) => void;
    mutatingFetch.mockImplementation(() => new Promise<Response>((resolve) => { resolveRequest = resolve; }));
    render();
    const file = new File(['avatar'], 'avatar.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Нове фото профілю'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Завантажити фото' }));

    expect(await screen.findByRole('button', { name: 'Завантажуємо…' })).toBeDisabled();
    const body = mutatingFetch.mock.calls[0]?.[1]?.body as FormData;
    expect(mutatingFetch).toHaveBeenCalledWith('/api/profile/avatar', expect.objectContaining({ method: 'POST', body }));
    expect(body.getAll('file')).toEqual([file]);
    resolveRequest(new Response(JSON.stringify({ ...baseProfile, avatarUrl: '/api/media/profile/avatar?v=def' }), { status: 200 }));
    expect(await screen.findByText('Фото профілю оновлено')).toBeInTheDocument();
  });

  it('rejects unsupported and oversized avatars before a request', () => {
    render();
    const input = screen.getByLabelText('Нове фото профілю');
    fireEvent.change(input, { target: { files: [new File(['x'], 'avatar.gif', { type: 'image/gif' })] } });
    expect(screen.getByRole('alert')).toHaveTextContent('JPEG, PNG або WebP');
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })] } });
    expect(screen.getByRole('alert')).toHaveTextContent('не більше 5 МБ');
    expect(mutatingFetch).not.toHaveBeenCalled();
  });

  it('deletes the avatar only after global confirmation', async () => {
    mutatingFetch.mockResolvedValue(new Response(JSON.stringify({ ...baseProfile, avatarUrl: null }), { status: 200 }));
    render();
    fireEvent.click(screen.getByRole('button', { name: 'Видалити фото' }));
    expect(screen.getByRole('dialog', { name: 'Видалити фото профілю?' })).toBeInTheDocument();
    expect(mutatingFetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Так, видалити' }));
    await waitFor(() => expect(mutatingFetch).toHaveBeenCalledWith('/api/profile/avatar', { method: 'DELETE' }));
  });

  it('changes a local password and clears all secret fields', async () => {
    mutatingFetch.mockResolvedValue(new Response(null, { status: 204 }));
    render();
    fireEvent.change(screen.getByLabelText('Поточний пароль'), { target: { value: 'current-password' } });
    fireEvent.change(screen.getByLabelText('Новий пароль'), { target: { value: 'new-password-123' } });
    fireEvent.change(screen.getByLabelText('Повторіть новий пароль'), { target: { value: 'new-password-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Змінити пароль' }));

    await waitFor(() => expect(mutatingFetch).toHaveBeenCalledWith('/api/profile/password', expect.objectContaining({ method: 'POST' })));
    expect(screen.getByLabelText('Поточний пароль')).toHaveValue('');
    expect(screen.getByLabelText('Новий пароль')).toHaveValue('');
    expect(screen.getByLabelText('Повторіть новий пароль')).toHaveValue('');
    expect(await screen.findByText('Пароль змінено')).toBeInTheDocument();
  });

  it('shows Google sign-in instead of password controls when password changes are unavailable', () => {
    render({ ...baseProfile, signInMethods: ['GOOGLE'], canChangePassword: false });
    expect(screen.getByText('Вхід через Google')).toBeInTheDocument();
    expect(screen.queryByLabelText('Поточний пароль')).not.toBeInTheDocument();
  });

  it('renders account facts as read-only text and Kyiv time elements', () => {
    render();
    const account = screen.getByRole('region', { name: 'Акаунт' });
    expect(within(account).getByText('ihor@example.com')).toBeInTheDocument();
    expect(within(account).getByText('Власник')).toBeInTheDocument();
    expect(within(account).queryByDisplayValue('ihor@example.com')).not.toBeInTheDocument();
    const times = within(account).getAllByRole('time');
    expect(times[0]).toHaveAttribute('datetime', baseProfile.createdAt);
    expect(times[1]).toHaveAttribute('datetime', baseProfile.lastLoginAt);
    expect(times[0]).toHaveTextContent('13:00');
    expect(times[1]).toHaveTextContent('14:00');
  });

  it('logs out through the protected mutation and refreshes only after success', async () => {
    mutatingFetch.mockResolvedValueOnce(new Response(null, { status: 500 })).mockResolvedValueOnce(new Response(null, { status: 204 }));
    render();
    fireEvent.click(screen.getByRole('button', { name: 'Вийти з акаунта' }));
    await waitFor(() => expect(mutatingFetch).toHaveBeenCalledTimes(1));
    expect(refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Вийти з акаунта' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  it('renders profile controls and account facts in English', () => {
    render(baseProfile, 'en');
    expect(screen.getByRole('heading', { name: 'Personal information' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Ігор Швець');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Account' })).getByText('Owner')).toBeInTheDocument();
  });
});
