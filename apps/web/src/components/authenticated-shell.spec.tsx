import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthenticatedShell } from './authenticated-shell';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('AuthenticatedShell', () => {
  it('renders navigation, header, and content once', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    render(<AuthenticatedShell active="orders" session={{ name: 'Ігор', email: 'owner@example.com', membershipRole: 'OWNER' }}><h1>Замовлення</h1></AuthenticatedShell>);
    expect(screen.getByRole('link', { name: 'AutoSale' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Меню профілю' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Замовлення' })).toBeInTheDocument();
  });
});
