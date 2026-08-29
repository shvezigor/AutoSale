import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { authenticatedApiFetch, getServerSession } = vi.hoisted(() => ({
  authenticatedApiFetch: vi.fn(),
  getServerSession: vi.fn(),
}));

vi.mock('../../src/auth/session', () => ({ authenticatedApiFetch, getServerSession }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import SettingsPage from './page';

afterEach(() => {
  cleanup();
  authenticatedApiFetch.mockReset();
  getServerSession.mockReset();
});

describe('SettingsPage', () => {
  it('shows a manager only the safe Instagram connection card', async () => {
    getServerSession.mockResolvedValue({
      userId: '3e6855ae-48a2-4d4d-8c39-5bf7d10f1a03',
      email: 'manager@example.com',
      name: 'Іван',
      platformRole: 'USER',
      tenantId: '1f713392-fdbc-4e3c-9824-db207934bff4',
      membershipRole: 'MANAGER',
    });
    authenticatedApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'ACTIVE',
        accountId: '17841400000000000',
        username: 'autosale_store',
        tokenExpiresAt: null,
        lastVerifiedAt: '2026-08-28T12:00:00.000Z',
        lastErrorCode: null,
        cleanupStatus: 'NONE',
        cleanupErrorCode: null,
      }),
    });

    render(await SettingsPage());

    expect(authenticatedApiFetch).toHaveBeenCalledTimes(1);
    expect(authenticatedApiFetch).toHaveBeenCalledWith('/api/integrations/instagram');
    expect(screen.getByText('@autosale_store')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Підтвердження замовлень' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Google Sheets' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Instagram/ })).not.toBeInTheDocument();
  });
});
