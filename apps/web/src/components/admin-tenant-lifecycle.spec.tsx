import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminTenantLifecycle } from './admin-tenant-lifecycle';

const mutatingFetch = vi.fn();
vi.mock('../auth/csrf-fetch', () => ({ mutatingFetch: (...args: unknown[]) => mutatingFetch(...args) }));

describe('AdminTenantLifecycle', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 })));
    mutatingFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('loads compact lifecycle controls without exposing a physical deletion action', async () => {
    render(<AdminTenantLifecycle tenantId="11111111-1111-4111-8111-111111111111" tenantName="Fictional Store" />);

    fireEvent.click(screen.getByRole('button', { name: 'Керувати даними' }));
    expect(await screen.findByRole('button', { name: 'Створити експорт' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Підготувати видалення' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /видалити дані назавжди/i })).not.toBeInTheDocument();
  });

  it('validates tenant name and current password next to the fields before deletion preparation', async () => {
    render(<AdminTenantLifecycle tenantId="11111111-1111-4111-8111-111111111111" tenantName="Fictional Store" />);
    fireEvent.click(screen.getByRole('button', { name: 'Керувати даними' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Підготувати видалення' }));

    fireEvent.click(screen.getByRole('button', { name: 'Підтвердити' }));

    const tenantName = screen.getByLabelText('Введіть «Fictional Store»');
    const password = screen.getByLabelText('Поточний пароль');
    await waitFor(() => expect(tenantName).toHaveAttribute('aria-invalid', 'true'));
    expect(password).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Введіть повну назву організації без змін.')).toBeVisible();
    expect(screen.getByText('Введіть поточний пароль.')).toBeVisible();
    expect(document.activeElement).toBe(tenantName);
    expect(mutatingFetch).not.toHaveBeenCalled();
  });
});
