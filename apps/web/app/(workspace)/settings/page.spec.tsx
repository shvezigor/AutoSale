import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticatedApiFetch, getServerSession } = vi.hoisted(() => ({
  authenticatedApiFetch: vi.fn(),
  getServerSession: vi.fn(),
}));

vi.mock('../../../src/auth/session', () => ({ authenticatedApiFetch, getServerSession }));
vi.mock('next/navigation', () => ({ usePathname: () => '/settings', useRouter: () => ({ refresh: vi.fn() }) }));

import SettingsPage from './page';
import WorkspaceLayout from '../layout';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
});

afterEach(() => {
  cleanup();
  authenticatedApiFetch.mockReset();
  getServerSession.mockReset();
  vi.unstubAllGlobals();
});

describe('SettingsPage', () => {
  it('groups catalogue and order destinations in the Data section', async () => {
    getServerSession.mockResolvedValue({
      userId: '3e6855ae-48a2-4d4d-8c39-5bf7d10f1a03',
      email: 'owner@example.com',
      name: 'Олена',
      platformRole: 'USER',
      tenantId: '1f713392-fdbc-4e3c-9824-db207934bff4',
      membershipRole: 'OWNER',
    });
    authenticatedApiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'DISCONNECTED', accountId: null, username: null, tokenExpiresAt: null, lastVerifiedAt: null, lastErrorCode: null, cleanupStatus: 'NONE', cleanupErrorCode: null, cleanupAbandonEligible: false }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ACTIVE', email: 'owner@gmail.com', grantedScopes: ['drive.file'], connectedAt: '2026-09-01T08:00:00.000Z', lastVerifiedAt: '2026-09-01T08:00:00.000Z', lastErrorCode: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ available: true, botUsername: 'AutoSaleBot', personal: { connected: false, displayName: null, username: null, linkedAt: null } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ businessConnected: true, selectedDestinationId: null, autoDispatch: false, destinations: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvalMode: 'REVIEW', minimumConfidence: 0.8, promptVersion: 'v1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ spreadsheetId: null, sheetName: 'Orders', status: 'NOT_CONFIGURED', requiredHeaders: ['order_id'], lastValidatedAt: null, errorSummary: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ([{ id: '44444444-4444-4444-8444-444444444444', type: 'GOOGLE_SHEETS', displayName: 'Каталог Google Sheets', status: 'PENDING', lastSyncedAt: null, lastErrorSummary: null, updatedAt: '2026-09-01T08:00:00.000Z' }]) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: '44444444-4444-4444-8444-444444444444', type: 'GOOGLE_SHEETS', displayName: 'Каталог Google Sheets', status: 'PENDING', lastSyncedAt: null, lastErrorSummary: null, updatedAt: '2026-09-01T08:00:00.000Z', spreadsheetId: 'sheet-id', sheetName: 'Товари', syncSchedule: 'DAILY', serviceAccountEmail: 'autosale@example.iam.gserviceaccount.com', authorizationAction: 'SHARE_SPREADSHEET' }) });

    render(await WorkspaceLayout({ children: await SettingsPage() }));

    expect(screen.getByRole('tablist', { name: 'Розділи налаштувань' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Соцмережі/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Telegram/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Google Sheets' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Підтвердження замовлень' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /Дані/ }));

    expect(screen.getByRole('heading', { name: 'Товари' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Експорт замовлень' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Google-акаунт' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Підключення каналів' })).not.toBeInTheDocument();
    expect(authenticatedApiFetch).toHaveBeenCalledWith('/api/catalogue/sources/44444444-4444-4444-8444-444444444444');
    fireEvent.click(screen.getByRole('tab', { name: /Telegram/ }));
    expect(screen.getByRole('heading', { name: 'Постачальник' })).toBeInTheDocument();
  });

  it('shows a manager only the safe Instagram connection card', async () => {
    getServerSession.mockResolvedValue({
      userId: '3e6855ae-48a2-4d4d-8c39-5bf7d10f1a03',
      email: 'manager@example.com',
      name: 'Іван',
      platformRole: 'USER',
      tenantId: '1f713392-fdbc-4e3c-9824-db207934bff4',
      membershipRole: 'MANAGER',
    });
    authenticatedApiFetch
      .mockResolvedValueOnce({
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
        cleanupAbandonEligible: false,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'ACTIVE', email: null, grantedScopes: [], connectedAt: null, lastVerifiedAt: null, lastErrorCode: null }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ available: true, botUsername: 'AutoSaleBot', personal: { connected: true, displayName: 'Іван', username: 'ivan_manager', linkedAt: '2026-09-01T08:00:00.000Z' } }),
      });

    render(await WorkspaceLayout({ children: await SettingsPage() }));

    expect(authenticatedApiFetch).toHaveBeenCalledTimes(3);
    expect(authenticatedApiFetch).toHaveBeenCalledWith('/api/integrations/instagram');
    expect(authenticatedApiFetch).toHaveBeenCalledWith('/api/integrations/google');
    expect(authenticatedApiFetch).toHaveBeenCalledWith('/api/integrations/telegram');
    expect(screen.getByText('@autosale_store')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Підтвердження замовлень' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Дані/ }));
    expect(screen.getByRole('heading', { name: 'Дані та синхронізація' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Instagram/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Telegram/ }));
    expect(screen.getByText('@ivan_manager')).toBeInTheDocument();
  });
});
