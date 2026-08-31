import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PrimaryNavigation } from './primary-navigation';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); refresh.mockClear(); });

describe('PrimaryNavigation', () => {
  it('shows settings but hides team management from managers', () => {
    render(<PrimaryNavigation active="orders" session={{ name: 'Іван', email: 'manager@example.com', membershipRole: 'MANAGER' }} />);
    expect(screen.queryByRole('link', { name: 'Команда' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Налаштування' })).toHaveAttribute('href', '/settings');
    expect(screen.getByRole('link', { name: 'Каталог' })).toHaveAttribute('href', '/catalogue');
  });

  it('logs out with csrf protection', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf-token' }) })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(<PrimaryNavigation active="conversations" session={{ name: 'Олена', email: 'owner@example.com', membershipRole: 'OWNER' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Вийти' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'x-csrf-token': 'csrf-token' }) })));
    expect(refresh).toHaveBeenCalled();
  });
});
