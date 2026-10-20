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

  it('validates the scoped CSV export next to its fields before requesting step-up', () => {
    render(<AdminDemoLeadsTable initial={{ items: [lead], nextCursor: null }} status="ALL" />);
    fireEvent.click(screen.getByRole('button', { name: 'Експорт CSV' }));
    fireEvent.change(screen.getByLabelText('Від дати'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('До дати'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Завантажити CSV' }));
    expect(screen.getByLabelText('Від дати')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('До дати')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Поточний пароль')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Від дати')).toHaveFocus();
  });

  it('focuses the password when it is the only invalid CSV export field', () => {
    render(<AdminDemoLeadsTable initial={{ items: [lead], nextCursor: null }} status="ALL" />);
    fireEvent.click(screen.getByRole('button', { name: 'Експорт CSV' }));
    fireEvent.click(screen.getByRole('button', { name: 'Завантажити CSV' }));
    expect(screen.getByLabelText('Від дати')).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('До дати')).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Поточний пароль')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Поточний пароль')).toHaveFocus();
  });
});
