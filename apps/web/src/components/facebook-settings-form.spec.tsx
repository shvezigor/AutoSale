import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { FacebookSettingsForm } from './facebook-settings-form';

const initial = {
  status: 'NOT_CONNECTED' as const,
  platformAvailability: 'AVAILABLE' as const,
  pageId: null,
  pageName: null,
  tokenExpiresAt: null,
  lastVerifiedAt: null,
  lastErrorCode: null,
  cleanupStatus: 'NONE' as const,
  cleanupErrorCode: null,
};

afterEach(cleanup);

describe('FacebookSettingsForm', () => {
  it('preserves an active connection while explaining an administrator pause', () => {
    render(<FacebookSettingsForm initial={{
      ...initial,
      status: 'ACTIVE',
      platformAvailability: 'ADMIN_DISABLED',
      pageId: 'fictional-page',
      pageName: 'Fictional Shop',
    }} membershipRole="OWNER" />);

    expect(screen.getByText('Fictional Shop')).toBeVisible();
    expect(screen.getAllByText('Активне').length).toBeGreaterThan(0);
    expect(screen.getByText(/тимчасово призупинено адміністратором Sales AITO/i)).toBeVisible();
    expect(screen.queryByRole('button', { name: /підключити Facebook|підключити сторінку/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Відключити Facebook' })).toBeVisible();
    expect(document.body.textContent).not.toMatch(/environment|credential|secret/i);
  });

  it('shows deployment unavailability without an activation action for a manager', () => {
    render(<FacebookSettingsForm initial={{ ...initial, platformAvailability: 'DEPLOYMENT_UNAVAILABLE' }} membershipRole="MANAGER" />);

    expect(screen.getByText(/Facebook ще не доступний/i)).toBeVisible();
    expect(screen.getByText(/Sales AITO/)).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows Page selection errors next to the selector and keeps the selection flow open', async () => {
    render(<FacebookSettingsForm
      initial={initial}
      membershipRole="OWNER"
      selection={{
        attemptId: '11111111-1111-4111-8111-111111111111',
        pages: [{ pageId: 'fictional-page-1', pageName: 'Fictional Shop' }],
      }}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Підключити сторінку' }));

    expect(screen.getByLabelText('Сторінка Facebook')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Оберіть сторінку Facebook')).toBeVisible();
    expect(screen.getByRole('option', { name: 'Fictional Shop' })).toBeInTheDocument();
  });

  it('does not expose mutations to a manager', () => {
    render(<FacebookSettingsForm initial={{ ...initial, status: 'ACTIVE', pageId: 'page', pageName: 'Fictional Shop' }} membershipRole="MANAGER" />);

    expect(screen.getByText('Лише перегляд. Підключенням керує власник робочого простору.')).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
