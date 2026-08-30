import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminDashboard } from './admin-dashboard';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(cleanup);

describe('AdminDashboard privacy', () => {
  it('shows aggregates without customer data or business links', () => {
    render(<AdminDashboard tenants={[{ tenantId: '11111111-1111-4111-8111-111111111111', tenantName: 'Test Store', status: 'ACTIVE', ownerEmail: 'owner@example.com', userCount: 2, orderCount: 4, createdAt: '2026-08-27T00:00:00.000Z' }]} health={{ status: 'ok' }} />);
    expect(screen.getByText('2 користувачі')).toBeInTheDocument();
    expect(screen.queryByText(/телефон|адреса|повідомлення клієнта/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /діалоги|замовлення/i })).not.toBeInTheDocument();
  });
});
