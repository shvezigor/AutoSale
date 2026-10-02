import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { FacebookSettingsForm } from './facebook-settings-form';

const initial = {
  status: 'NOT_CONNECTED' as const,
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
