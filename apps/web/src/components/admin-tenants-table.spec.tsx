import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminTenantsTable } from './admin-tenants-table';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
afterEach(() => { cleanup(); push.mockReset(); });

const tenants = [
  { tenantId: '11111111-1111-4111-8111-111111111111', tenantName: 'Alpha Store', status: 'ACTIVE' as const, ownerEmail: 'alpha@example.test', userCount: 3, orderCount: 8, createdAt: '2026-09-01T00:00:00.000Z' },
  { tenantId: '22222222-2222-4222-8222-222222222222', tenantName: 'Beta Studio', status: 'BLOCKED' as const, ownerEmail: 'beta@example.test', userCount: 1, orderCount: 2, createdAt: '2026-10-01T00:00:00.000Z' },
];

describe('AdminTenantsTable', () => {
  it('searches and filters privacy-safe client rows', () => {
    render(<AdminTenantsTable tenants={tenants} />);
    expect(screen.getAllByRole('row')).toHaveLength(3);

    fireEvent.change(screen.getByPlaceholderText('Назва або email власника'), { target: { value: 'beta' } });
    expect(screen.queryByText('Alpha Store')).not.toBeInTheDocument();
    expect(screen.getByText('Beta Studio')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Статус'), { target: { value: 'ACTIVE' } });
    expect(screen.getByText('Нічого не знайдено')).toBeInTheDocument();
  });

  it('sorts rows and opens detail by row click, keyboard and explicit action', () => {
    render(<AdminTenantsTable tenants={tenants} />);
    fireEvent.click(screen.getByRole('button', { name: 'Сортувати за назвою' }));
    const rows = screen.getAllByRole('row');
    expect(within(rows[1]!).getByText('Alpha Store')).toBeInTheDocument();

    fireEvent.click(rows[1]!);
    expect(push).toHaveBeenCalledWith('/admin/tenants/11111111-1111-4111-8111-111111111111');
    fireEvent.keyDown(rows[2]!, { key: 'Enter' });
    expect(push).toHaveBeenCalledWith('/admin/tenants/22222222-2222-4222-8222-222222222222');
    expect(screen.getAllByRole('link', { name: 'Переглянути' })[0]).toHaveAttribute('href', '/admin/tenants/11111111-1111-4111-8111-111111111111');
  });
});
