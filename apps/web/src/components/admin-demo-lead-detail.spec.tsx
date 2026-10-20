import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminDemoLeadDetail } from './admin-demo-lead-detail';

const refresh = vi.fn();
const replace = vi.fn();
const mutatingFetch = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, replace }) }));
vi.mock('../auth/csrf-fetch', () => ({ mutatingFetch: (...args: unknown[]) => mutatingFetch(...args) }));
afterEach(() => { cleanup(); refresh.mockReset(); replace.mockReset(); mutatingFetch.mockReset(); });

const lead = {
  id: '22222222-2222-4222-8222-222222222222', name: 'Fictional Olena', company: 'Fictional Shop',
  email: 'olena@example.test', phone: null, orderVolume: 'UNDER_50', note: 'Fictional note', locale: 'en' as const,
  consentVersion: '2026-09-17', consentedAt: '2026-10-20T10:00:00.000Z', status: 'NEW' as const,
  notificationStatus: 'PENDING' as const, createdAt: '2026-10-20T10:00:00.000Z', updatedAt: '2026-10-20T10:00:00.000Z',
  version: 0, lastOperatorActionAt: null, deletionAvailable: true,
};

describe('AdminDemoLeadDetail', () => {
  it('shows full contact only on the protected detail page and returns to the queue', () => {
    render(<AdminDemoLeadDetail lead={lead} />);
    expect(screen.getByRole('heading', { name: 'Fictional Shop' })).toBeInTheDocument();
    expect(screen.getByText('olena@example.test')).toBeInTheDocument();
    expect(screen.getByText('Fictional note')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'До демозаявок' })).toHaveAttribute('href', '/admin/leads');
  });

  it('does not offer deletion while erasure recovery has not been enabled', () => {
    render(<AdminDemoLeadDetail lead={{ ...lead, deletionAvailable: false }} />);
    expect(screen.queryByRole('button', { name: 'Видалити заявку' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Завантажити JSON' })).toBeInTheDocument();
  });

  it('submits a versioned status change and refreshes persisted detail', async () => {
    mutatingFetch.mockResolvedValue(new Response(JSON.stringify({ id: lead.id, status: 'CONTACTED', version: 1 }), { status: 200 }));
    render(<AdminDemoLeadDetail lead={lead} />);
    fireEvent.click(screen.getByRole('button', { name: 'Позначити як опрацьовану' }));
    await waitFor(() => expect(mutatingFetch).toHaveBeenCalledWith(`/api/admin/demo-leads/${lead.id}/status`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'CONTACTED', expectedVersion: 0 }),
    }));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('shows field-level errors, preserves values, and deletes only after purpose-bound reauthentication', async () => {
    mutatingFetch.mockResolvedValueOnce(new Response(JSON.stringify({ stepUpToken: 'fictional-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ deleted: true }), { status: 200 }));
    render(<AdminDemoLeadDetail lead={lead} />);
    fireEvent.click(screen.getByRole('button', { name: 'Видалити заявку' }));
    fireEvent.click(screen.getByRole('button', { name: 'Підтвердити' }));
    expect(screen.getByLabelText('Повний ID заявки')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Поточний пароль')).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(screen.getByLabelText('Повний ID заявки'), { target: { value: lead.id } });
    fireEvent.change(screen.getByLabelText('Поточний пароль'), { target: { value: 'fictional password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Підтвердити' }));
    await waitFor(() => expect(mutatingFetch).toHaveBeenCalledWith('/api/admin/reauth', expect.objectContaining({ body: JSON.stringify({ currentPassword: 'fictional password', purpose: 'DEMO_LEAD_DELETE' }) })));
    await waitFor(() => expect(mutatingFetch).toHaveBeenCalledWith(`/api/admin/demo-leads/${lead.id}/delete`, expect.objectContaining({ body: JSON.stringify({ confirmId: lead.id }) })));
    expect(replace).toHaveBeenCalledWith('/admin/leads');
  });
});
