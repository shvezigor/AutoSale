import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getServerSession } from '../../src/auth/session';
import WorkspaceLayout from './layout';

vi.mock('../../src/auth/session', () => ({ getServerSession: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/catalogue', useRouter: () => ({ refresh: vi.fn() }) }));

const ownerSession = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  name: 'Ігор',
  email: 'owner@example.com',
  platformRole: 'USER' as const,
  membershipRole: 'OWNER' as const,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('WorkspaceLayout', () => {
  it('keeps authenticated navigation around workspace content', async () => {
    vi.mocked(getServerSession).mockResolvedValue(ownerSession);
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));

    render(await WorkspaceLayout({ children: <h1>Каталог товарів</h1> }));

    expect(screen.getByRole('link', { name: 'AutoSale' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Меню профілю' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Каталог товарів' }).parentElement).toHaveClass('workspace-route-transition');
  });

  it('does not expose workspace content without a session', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);

    const { container } = render(await WorkspaceLayout({ children: <h1>Приватні дані</h1> }));

    expect(container).toBeEmptyDOMElement();
  });
});
