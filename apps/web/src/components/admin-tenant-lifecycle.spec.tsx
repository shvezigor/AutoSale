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

  it('downloads the export from the authenticated API response instead of navigating to object storage', async () => {
    const request = {
      id: '22222222-2222-4222-8222-222222222222',
      tenantId: '11111111-1111-4111-8111-111111111111',
      kind: 'EXPORT',
      status: 'EXPORT_READY',
      reasonCode: 'ADMINISTRATIVE_TEST',
      requestedAt: '2026-10-02T09:00:00.000Z',
      ingestionFrozenAt: null,
      exportSha256: 'a'.repeat(64),
      exportSizeBytes: 42,
      exportManifestVersion: 1,
      exportReadyAt: '2026-10-02T09:01:00.000Z',
      exportExpiresAt: '2026-10-09T09:01:00.000Z',
      lastErrorCode: null,
      cancelledAt: null,
    };
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([request]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([request]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 })));
    mutatingFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ stepUpToken: 'fictional-step-up' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(new Blob(['fictional zip']), {
        status: 200,
        headers: { 'content-type': 'application/zip' },
      }));
    const createObjectURL = vi.fn().mockReturnValue('blob:fictional-export');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    render(<AdminTenantLifecycle tenantId={request.tenantId} tenantName="Fictional Store" />);
    fireEvent.click(screen.getByRole('button', { name: 'Керувати даними' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Завантажити' }));
    fireEvent.change(screen.getByLabelText('Поточний пароль'), { target: { value: 'fictional password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Підтвердити' }));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob)));
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fictional-export');
  });
});
