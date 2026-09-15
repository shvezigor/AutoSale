import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { authenticatedApiFetch, getServerSession } = vi.hoisted(() => ({
  authenticatedApiFetch: vi.fn(),
  getServerSession: vi.fn(),
}));
vi.mock('../../../src/auth/session', () => ({ authenticatedApiFetch, getServerSession }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/profile',
  useRouter: () => ({ refresh: vi.fn() }),
}));

import WorkspaceLayout from '../layout';
import { I18nProvider } from '../../../src/i18n/i18n-provider';
import ProfilePage from './page';

const profile = {
  userId: '11111111-1111-4111-8111-111111111111',
  email: 'ihor@example.com',
  name: 'Ігор Швець',
  phone: '+380501112233',
  locale: 'uk' as const,
  avatarUrl: null,
  membershipRole: 'OWNER' as const,
  signInMethods: ['PASSWORD'] as const,
  canChangePassword: true,
  createdAt: '2026-09-14T10:00:00.000Z',
  lastLoginAt: '2026-09-14T11:00:00.000Z',
};

afterEach(() => {
  cleanup();
  authenticatedApiFetch.mockReset();
  getServerSession.mockReset();
  vi.unstubAllGlobals();
});

describe('ProfilePage', () => {
  it('renders the complete profile inside the authenticated workspace', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    getServerSession.mockResolvedValue({
      name: profile.name,
      email: profile.email,
      membershipRole: profile.membershipRole,
      avatarUrl: null,
    });
    authenticatedApiFetch.mockResolvedValue({ ok: true, json: async () => profile });

    render(<I18nProvider locale="uk" authenticated>{await WorkspaceLayout({ children: await ProfilePage() })}</I18nProvider>);

    expect(authenticatedApiFetch).toHaveBeenCalledWith('/api/profile');
    expect(screen.getByRole('heading', { name: 'Мій профіль' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Особиста інформація' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Безпека' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Акаунт' })).toBeInTheDocument();
  });

  it('throws when the API cannot load the profile', async () => {
    authenticatedApiFetch.mockResolvedValue({ ok: false });
    await expect(ProfilePage()).rejects.toThrow('Не вдалося завантажити профіль');
  });
});
