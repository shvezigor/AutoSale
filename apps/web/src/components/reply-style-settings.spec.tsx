import type { ReplyStyle } from '../../../../packages/contracts/src/reply-drafts';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { I18nProvider } from '../i18n/i18n-provider';
import { ReplyStyleSettings } from './reply-style-settings';

const initial: ReplyStyle = {
  tenantId: '11111111-1111-4111-8111-111111111111', enabled: false, companyName: '',
  tone: 'NEUTRAL', addressForm: 'FORMAL_YOU', guidance: '',
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('ReplyStyleSettings', () => {
  it('validates company name beside its field and saves the enabled style', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf-token' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...initial, enabled: true, companyName: 'Fictional Shop' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<I18nProvider locale="en" authenticated><ReplyStyleSettings initial={initial} canEdit /></I18nProvider>);
    fireEvent.click(screen.getByRole('button', { name: /AI reply style/ }));
    const toggle = screen.getByRole('checkbox', { name: 'Enable AI reply drafts' });
    expect(toggle.closest('label')).toHaveClass('reply-style-toggle');
    expect(screen.getByLabelText('Company name in replies').closest('.form-field')).toHaveClass('reply-style-field');
    expect(screen.getByLabelText('Additional guidance').closest('.form-field')).toHaveClass('reply-style-field-wide');
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(screen.getByText('Enter a company name to enable drafts.')).toBeVisible();
    expect(screen.getByLabelText('Company name in replies')).toHaveAttribute('aria-invalid', 'true');
    expect(document.activeElement).toBe(screen.getByLabelText('Company name in replies'));
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Company name in replies'), { target: { value: 'Fictional Shop' } });
    expect(screen.queryByText('Enter a company name to enable drafts.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/settings/reply-style', expect.objectContaining({
      method: 'PATCH', body: expect.stringContaining('Fictional Shop'),
    })));
    expect(await screen.findByText('Reply style saved.')).toBeVisible();
  });

  it('shows read-only style to a manager', () => {
    render(<I18nProvider locale="uk" authenticated><ReplyStyleSettings initial={initial} canEdit={false} /></I18nProvider>);
    fireEvent.click(screen.getByRole('button', { name: /Стиль AI-відповідей/ }));
    expect(screen.getByLabelText('Назва компанії у відповіді')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Зберегти налаштування' })).not.toBeInTheDocument();
  });
});
