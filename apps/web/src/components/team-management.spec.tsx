import { cleanup, render as rtlRender, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TeamManagement } from './team-management';
import { ActivityProvider } from './activity-provider';
import { ToastProvider } from './toast-provider';

function render(ui: React.ReactElement) { return rtlRender(<ToastProvider><ActivityProvider>{ui}</ActivityProvider></ToastProvider>); }

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(cleanup);

describe('TeamManagement', () => {
  it('shows members and pending invitations', () => {
    render(<TeamManagement initial={{ members: [{ id: 'm1', email: 'owner@example.com', name: 'Олена', role: 'OWNER', status: 'ACTIVE', createdAt: '2026-08-27T00:00:00.000Z' }], invitations: [{ id: 'i1', email: 'manager@example.com', role: 'MANAGER', expiresAt: '2026-09-03T00:00:00.000Z', createdAt: '2026-08-27T00:00:00.000Z' }] }} />);
    expect(screen.getByRole('heading', { name: 'Команда' })).toBeInTheDocument();
    expect(screen.getByText('manager@example.com')).toBeInTheDocument();
    expect(screen.getByText(/діє до/i)).toBeInTheDocument();
  });
});
