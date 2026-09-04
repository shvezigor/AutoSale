import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GoogleOnboardingForm } from './google-onboarding-form';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('GoogleOnboardingForm', () => {
  it('shows verified identity as text and submits only the business name', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false }));
    vi.stubGlobal('fetch', fetchMock);
    render(<GoogleOnboardingForm email="owner@example.com" suggestedName="Owner" />);
    expect(screen.getByText('owner@example.com')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Email' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Назва бізнесу'), { target: { value: 'Крамниця' } });
    fireEvent.click(screen.getByRole('button', { name: 'Створити робочий простір' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/google/onboarding', expect.objectContaining({ body: JSON.stringify({ tenantName: 'Крамниця' }) })));
  });

  it('offers a safe restart when onboarding fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    render(<GoogleOnboardingForm email="owner@example.com" suggestedName="Owner" />);
    fireEvent.change(screen.getByLabelText('Назва бізнесу'), { target: { value: 'Крамниця' } });
    fireEvent.click(screen.getByRole('button', { name: 'Створити робочий простір' }));
    expect(await screen.findByRole('link', { name: 'Почати знову' })).toHaveAttribute('href', '/login');
  });
});
