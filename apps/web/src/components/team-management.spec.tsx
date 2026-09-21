import { cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TeamManagement } from './team-management';
import { ActivityProvider } from './activity-provider';
import { ToastProvider } from './toast-provider';
import { I18nProvider } from '../i18n/i18n-provider';

function render(ui: React.ReactElement) { return rtlRender(<ToastProvider><ActivityProvider>{ui}</ActivityProvider></ToastProvider>); }

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('TeamManagement', () => {
  it('shows an email field error, focuses it, and does not send an invalid invitation', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<TeamManagement initial={{ members: [], invitations: [] }} />);
    fireEvent.change(screen.getByLabelText('Email менеджера'), { target: { value: 'not-an-email' } });

    fireEvent.click(screen.getByRole('button', { name: 'Запросити' }));

    expect(await screen.findByText('Введіть коректну email-адресу.')).toHaveAttribute('id', 'team-invite-email-error');
    expect(screen.getByLabelText('Email менеджера')).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('translates team controls while preserving member data', () => {
    render(<I18nProvider locale="en" authenticated={false}><TeamManagement initial={{ members: [{ id: 'm1', email: 'owner@example.com', name: 'Олена', role: 'OWNER', status: 'ACTIVE', createdAt: '2026-08-27T00:00:00.000Z' }], invitations: [{ id: 'i1', email: 'manager@example.com', role: 'MANAGER', expiresAt: '2026-09-03T00:00:00.000Z', createdAt: '2026-08-27T00:00:00.000Z' }] }} /></I18nProvider>);
    expect(screen.getByRole('heading', { name: 'Team' })).toBeInTheDocument();
    expect(screen.getByText('Олена')).toBeInTheDocument();
    expect(screen.getByText('manager@example.com')).toBeInTheDocument();
    expect(screen.getByText(/Valid until/)).toBeInTheDocument();
  });
  it('shows members and pending invitations', () => {
    render(<TeamManagement initial={{ members: [{ id: 'm1', email: 'owner@example.com', name: 'Олена', role: 'OWNER', status: 'ACTIVE', createdAt: '2026-08-27T00:00:00.000Z' }], invitations: [{ id: 'i1', email: 'manager@example.com', role: 'MANAGER', expiresAt: '2026-09-03T00:00:00.000Z', createdAt: '2026-08-27T00:00:00.000Z' }] }} />);
    expect(screen.getByRole('heading', { name: 'Команда' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Запросити менеджера' })).toBeInTheDocument();
    expect(screen.getByText('manager@example.com')).toBeInTheDocument();
    expect(screen.getByText(/діє до/i)).toBeInTheDocument();
  });
});
