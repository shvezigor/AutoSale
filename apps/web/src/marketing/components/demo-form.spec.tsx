import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DemoForm } from './demo-form';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('DemoForm', () => {
  it('shows all invalid fields, focuses the first and preserves typed values', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<DemoForm locale="uk" />);
    fireEvent.change(screen.getByLabelText('Ім’я'), { target: { value: 'А' } });
    fireEvent.change(screen.getByLabelText('Компанія або магазин'), { target: { value: 'Б' } });
    fireEvent.click(screen.getByRole('button', { name: 'Замовити демо' }));
    expect(screen.getByLabelText('Ім’я')).toHaveFocus();
    expect(screen.getByText('Введіть щонайменше 2 символи.', { selector: '#demo-name-error' })).toBeInTheDocument();
    expect(screen.getByText('Введіть щонайменше 2 символи.', { selector: '#demo-company-error' })).toBeInTheDocument();
    expect(screen.getByText('Оберіть кількість замовлень.', { selector: '#demo-orderVolume-error' })).toBeInTheDocument();
    expect(screen.getByText('Потрібна згода на обробку даних.', { selector: '#demo-privacyConsent-error' })).toBeInTheDocument();
    expect(screen.getByLabelText('Ім’я')).toHaveValue('А');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps a service outage at form level without discarding values', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    render(<DemoForm locale="en" />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Alice' } });
    fireEvent.change(screen.getByLabelText('Company or store'), { target: { value: 'Fictional Shop' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'alice@example.test' } });
    fireEvent.change(screen.getByLabelText('Monthly orders'), { target: { value: 'UNDER_50' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Book a demo' }));
    expect(await screen.findByText(/Could not submit/)).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Alice');
  });
});
