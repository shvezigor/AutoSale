import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerSession } from '../../src/auth/session';
import AdminLayout from './layout';

vi.mock('../../src/auth/session', () => ({ getServerSession: vi.fn() }));
vi.mock('../../src/components/admin-shell', () => ({
  AdminShell: ({ children }: { children: React.ReactNode }) => <section data-testid="admin-shell">{children}</section>,
}));

const session = vi.mocked(getServerSession);

beforeEach(() => session.mockReset());

describe('AdminLayout', () => {
  it.each([null, { platformRole: 'USER' }])('does not render admin content for a non-admin session', async (value) => {
    session.mockResolvedValue(value as Awaited<ReturnType<typeof getServerSession>>);

    const result = await AdminLayout({ children: <div>Fictional admin-only content</div> });
    const view = render(result);

    expect(view.container).toBeEmptyDOMElement();
    expect(screen.queryByText('Fictional admin-only content')).not.toBeInTheDocument();
  });

  it('renders the shell for a platform administrator', async () => {
    session.mockResolvedValue({ platformRole: 'PLATFORM_ADMIN', name: 'Fictional Admin', email: 'admin@example.test' } as Awaited<ReturnType<typeof getServerSession>>);

    render(await AdminLayout({ children: <div>Fictional admin-only content</div> }));

    expect(screen.getByTestId('admin-shell')).toBeInTheDocument();
    expect(screen.getByText('Fictional admin-only content')).toBeInTheDocument();
  });
});
