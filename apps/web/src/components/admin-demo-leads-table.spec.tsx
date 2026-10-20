import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminDemoLeadsTable } from './admin-demo-leads-table';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
afterEach(() => { cleanup(); push.mockReset(); });

const lead = {
  id: '22222222-2222-4222-8222-222222222222', company: 'Fictional Shop', maskedContact: 'o***@***',
  status: 'NEW' as const, notificationStatus: 'PENDING' as const, createdAt: '2026-10-20T10:00:00.000Z', version: 0,
};

describe('AdminDemoLeadsTable', () => {
  it('shows a masked, linked lead without exposing contact or note', () => {
    render(<AdminDemoLeadsTable initial={{ items: [lead], nextCursor: null }} status="ALL" />);
    expect(screen.getByRole('heading', { name: 'Демозаявки' })).toBeInTheDocument();
    expect(screen.getByText('Fictional Shop')).toBeInTheDocument();
    expect(screen.getByText('o***@***')).toBeInTheDocument();
    expect(screen.queryByText('olena@example.test')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Переглянути' })).toHaveAttribute('href', `/admin/leads/${lead.id}`);
  });

  it('navigates to the selected lifecycle filter', () => {
    render(<AdminDemoLeadsTable initial={{ items: [lead], nextCursor: null }} status="ALL" />);
    fireEvent.change(screen.getByLabelText('Статус'), { target: { value: 'CONTACTED' } });
    expect(push).toHaveBeenCalledWith('/admin/leads?status=CONTACTED');
  });
});
