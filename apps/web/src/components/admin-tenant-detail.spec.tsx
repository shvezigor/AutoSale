import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfirmProvider } from './confirm-provider';
import { AdminTenantDetail } from './admin-tenant-detail';

const refresh = vi.fn();
const mutatingFetch = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('../auth/csrf-fetch', () => ({ mutatingFetch: (...args: unknown[]) => mutatingFetch(...args) }));

afterEach(() => { cleanup(); refresh.mockReset(); mutatingFetch.mockReset(); });

const tenant = { tenantId: '11111111-1111-4111-8111-111111111111', tenantName: 'Fictional Store', status: 'ACTIVE' as const, ownerEmail: 'owner@example.test', userCount: 2, orderCount: 4, createdAt: '2026-08-27T00:00:00.000Z' };

describe('AdminTenantDetail', () => {
  it('shows approved aggregates without tenant business data', () => {
    render(<ConfirmProvider><AdminTenantDetail tenant={tenant} /></ConfirmProvider>);
    expect(screen.getByRole('heading', { name: 'Fictional Store' })).toBeInTheDocument();
    expect(screen.getByText('owner@example.test')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.queryByText(/телефон|адреса|діалоги|товари/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'До списку клієнтів' })).toHaveAttribute('href', '/admin/tenants');
  });

  it('confirms blocking, uses the mutation endpoint and refreshes the detail', async () => {
    mutatingFetch.mockResolvedValue(new Response(JSON.stringify({ status: 'BLOCKED', revokedSessions: 2 }), { status: 200 }));
    render(<ConfirmProvider><AdminTenantDetail tenant={tenant} /></ConfirmProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Заблокувати організацію' }));
    expect(screen.getByRole('dialog', { name: 'Заблокувати Fictional Store?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Так, заблокувати' }));

    await waitFor(() => expect(mutatingFetch).toHaveBeenCalledWith('/api/admin/tenants/11111111-1111-4111-8111-111111111111/block', { method: 'POST' }));
    expect(refresh).toHaveBeenCalledOnce();
  });
});
