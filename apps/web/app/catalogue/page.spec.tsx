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
    authenticatedApiFetch.mockResolvedValue({ ok: true, json: async () => ({ items: [], page: 2, pageSize: 25, total: 0 }) });

    render(await CataloguePage({ searchParams: Promise.resolve({ page: '2', search: 'Luna' }) }));

    expect(authenticatedApiFetch).toHaveBeenCalledWith('/api/catalogue?page=2&pageSize=25&search=Luna');
    expect(screen.getByText('Товарів за цим запитом не знайдено.')).toBeInTheDocument();
  });

  it('throws when the initial catalogue fetch fails so the route error boundary can render recovery UI', async () => {
    getServerSession.mockResolvedValue({ name: 'Іван', email: 'manager@example.com', membershipRole: 'MANAGER' });
    authenticatedApiFetch.mockResolvedValue({ ok: false });

    await expect(CataloguePage({ searchParams: Promise.resolve({}) })).rejects.toThrow('Не вдалося завантажити каталог');
  });
});
