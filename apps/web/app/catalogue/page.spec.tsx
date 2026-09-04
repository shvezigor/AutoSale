import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { authenticatedApiFetch, getServerSession } = vi.hoisted(() => ({ authenticatedApiFetch: vi.fn(), getServerSession: vi.fn() }));
vi.mock('../../src/auth/session', () => ({ authenticatedApiFetch, getServerSession }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

import CataloguePage from './page';

afterEach(() => { cleanup(); authenticatedApiFetch.mockReset(); getServerSession.mockReset(); });

describe('CataloguePage', () => {
  it('loads the requested server page for the authenticated membership', async () => {
    getServerSession.mockResolvedValue({ name: 'Іван', email: 'manager@example.com', membershipRole: 'MANAGER' });
    authenticatedApiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [], page: 2, pageSize: 25, total: 0 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ([{ id: '44444444-4444-4444-8444-444444444444', type: 'GOOGLE_SHEETS', displayName: 'Каталог', status: 'ACTIVE', lastSyncedAt: null, lastErrorSummary: null, updatedAt: '2026-09-01T08:00:00.000Z' }]) });

    render(await CataloguePage({ searchParams: Promise.resolve({ page: '2', search: 'Luna' }) }));

    expect(authenticatedApiFetch).toHaveBeenCalledWith('/api/catalogue?page=2&pageSize=25&search=Luna');
    expect(authenticatedApiFetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('heading', { name: 'Оберіть джерело' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Обрати файл' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Налаштування → Дані' })).toHaveAttribute('href', '/settings?tab=data');
    expect(screen.getByText('Товарів за цим запитом не знайдено.')).toBeInTheDocument();
  });

  it('throws when the initial catalogue fetch fails so the route error boundary can render recovery UI', async () => {
    getServerSession.mockResolvedValue({ name: 'Іван', email: 'manager@example.com', membershipRole: 'MANAGER' });
    authenticatedApiFetch.mockResolvedValue({ ok: false });

    await expect(CataloguePage({ searchParams: Promise.resolve({}) })).rejects.toThrow('Не вдалося завантажити каталог');
  });
});
